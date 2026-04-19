"""Warm sandbox pool.

Each fresh `Sandbox.create()` pays ~18s for the OpenClaw gateway cold-start.
If we keep one sandbox pre-provisioned (gateway already up, model already
configured), the next deployment skips that 18s entirely.

Design (deliberately simple):

* One global pool. Capacity = `POOL_SIZE` (default 1).
* When the orchestrator wants a sandbox, it calls `acquire(model)`.
  - If the warm sandbox matches the requested model, take it and return it.
  - If it doesn't match (or pool is empty), set the model on the warm one
    OR create a fresh sandbox synchronously.
  - Either way, fire off `_replenish()` in the background so the pool
    refills before the next deployment.
* Each warm sandbox has the gateway running but **no repo cloned yet**. The
  orchestrator clones the repo after acquiring.
* Sandboxes have a 30-min Modal timeout. We refresh by destroying + creating
  a new one if the warm sandbox is older than `WARM_TTL_S`.

Concurrency: an `asyncio.Lock` guards pool access. Replenishment runs in
the background.

Failure modes: replenishment is best-effort. If it fails, the next acquire
falls back to a synchronous create.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

from app.services.sandbox import Sandbox

log = logging.getLogger(__name__)

POOL_SIZE = 3
WARM_TTL_S = 25 * 60  # refresh before Modal's 30-min timeout kicks in


@dataclass
class WarmSandbox:
    sb: Sandbox
    model: str
    created_at: float

    def expired(self) -> bool:
        return (time.time() - self.created_at) >= WARM_TTL_S


_pool: list[WarmSandbox] = []
_lock = asyncio.Lock()
_replenishing: set[str] = set()  # set of models currently being warmed


async def acquire(model: str) -> Sandbox:
    """Get a sandbox ready to chat. Synchronously fast-path from the pool;
    otherwise create one and trigger background replenishment.
    """
    async with _lock:
        # Look for a warm sandbox matching the requested model.
        match = next(
            (w for i, w in enumerate(_pool) if w.model == model and not w.expired()),
            None,
        )
        if match is not None:
            _pool.remove(match)
            log.info(
                "pool: HIT (model=%s, age=%.1fs, remaining=%d)",
                model, time.time() - match.created_at, len(_pool),
            )
            asyncio.create_task(_replenish(model))
            return match.sb

        # Warm but wrong model? Re-set model on it (cheap) and use it.
        wrong_model = next(
            (w for i, w in enumerate(_pool) if not w.expired()),
            None,
        )
        if wrong_model is not None:
            _pool.remove(wrong_model)
            log.info(
                "pool: WARM-WRONG-MODEL (had=%s, want=%s); reusing with model swap",
                wrong_model.model, model,
            )
            try:
                await asyncio.to_thread(wrong_model.sb.set_model, model)
            except Exception:
                log.exception("pool: model swap failed; will create fresh")
                await asyncio.to_thread(wrong_model.sb.terminate)
            else:
                asyncio.create_task(_replenish(model))
                return wrong_model.sb

        # Drop expired warm sandboxes.
        for w in list(_pool):
            if w.expired():
                log.info("pool: dropping expired warm sandbox (age=%.0fs)",
                         time.time() - w.created_at)
                _pool.remove(w)
                asyncio.create_task(asyncio.to_thread(w.sb.terminate))

    # MISS: provision synchronously, kick off replenish in parallel.
    log.info("pool: MISS (model=%s); provisioning fresh sandbox synchronously", model)
    asyncio.create_task(_replenish(model))
    return await asyncio.to_thread(_provision_warm_sb, model)


async def prewarm(model: str) -> None:
    """Public entrypoint to seed the pool at startup."""
    asyncio.create_task(_replenish(model))


async def shutdown() -> None:
    """Terminate all warm sandboxes. Call on app shutdown."""
    async with _lock:
        warmed, _pool[:] = list(_pool), []
    for w in warmed:
        await asyncio.to_thread(w.sb.terminate)
    log.info("pool: shutdown, terminated %d warm sandboxes", len(warmed))


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

def _provision_warm_sb(model: str) -> Sandbox:
    """Sync provision: create + set model + start gateway + warmup chat.

    The warmup chat forces OpenClaw to do its lazy first-request init
    (plugin loading, runtime backend, session bootstrap) HERE in the
    background, so the next real deploy doesn't pay that 30-60s tax.

    If the warmup chat fails we still return the sandbox — it's usable,
    just slower on first real use. We log a warning so it shows up.
    """
    sb = Sandbox.create()
    try:
        sb.set_model(model)
        sb.start_gateway()
        sb.warmup_chat()
    except Exception:
        sb.terminate()
        raise
    return sb


async def _replenish(model: str) -> None:
    """Refill the pool to POOL_SIZE for the given model.

    Skips if a replenish for this model is already in flight, to avoid
    racing concurrent acquires.
    """
    if model in _replenishing:
        return
    _replenishing.add(model)
    try:
        async with _lock:
            current = sum(1 for w in _pool if w.model == model and not w.expired())
            need = max(0, POOL_SIZE - current)
        for _ in range(need):
            log.info("pool: replenishing (model=%s)", model)
            t0 = time.time()
            try:
                sb = await asyncio.to_thread(_provision_warm_sb, model)
            except Exception:
                log.exception("pool: replenish failed")
                return
            elapsed = int((time.time() - t0) * 1000)
            async with _lock:
                _pool.append(WarmSandbox(sb=sb, model=model, created_at=time.time()))
                log.info(
                    "pool: warm sandbox ready in %dms (model=%s, total=%d)",
                    elapsed, model, len(_pool),
                )
    finally:
        _replenishing.discard(model)


async def snapshot() -> dict:
    """Return a JSON-friendly snapshot of the current pool state.

    Used by the diagnostics endpoint and the pool-status script.
    """
    async with _lock:
        items = []
        now = time.time()
        for w in _pool:
            age_s = now - w.created_at
            items.append({
                "sandbox_id": w.sb.object_id,
                "model": w.model,
                "age_s": round(age_s, 1),
                "ttl_remaining_s": round(WARM_TTL_S - age_s, 1),
                "expired": w.expired(),
            })
        return {
            "capacity": POOL_SIZE,
            "warm_ttl_s": WARM_TTL_S,
            "ready_count": len(items),
            "replenishing_models": sorted(_replenishing),
            "items": items,
        }


__all__ = ["acquire", "prewarm", "shutdown", "snapshot", "POOL_SIZE", "WARM_TTL_S"]
