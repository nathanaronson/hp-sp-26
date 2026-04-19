from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

UPLOAD_MAX_BYTES = 200 * 1024 * 1024  # 200 MB hard cap


@dataclass(frozen=True)
class UploadRecord:
    upload_id: str
    owner_user_id: str
    original_filename: str
    stored_filename: str
    archive_path: Path
    metadata_path: Path
    size: int
    created_at: str


def new_upload_id() -> str:
    return uuid.uuid4().hex


def archive_path_for(upload_id: str) -> Path:
    # Stable extension keeps extraction logic simple and avoids suffix guessing.
    return UPLOAD_DIR / f"{upload_id}.tar.gz"


def metadata_path_for(upload_id: str) -> Path:
    return UPLOAD_DIR / f"{upload_id}.meta.json"


def write_upload_metadata(
    *,
    upload_id: str,
    owner_user_id: str,
    original_filename: str,
    stored_filename: str,
    size: int,
) -> Path:
    meta = {
        "upload_id": upload_id,
        "owner_user_id": owner_user_id,
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "size": size,
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }
    meta_path = metadata_path_for(upload_id)
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return meta_path


def get_upload_record(upload_id: str) -> UploadRecord | None:
    archive_path = archive_path_for(upload_id)
    meta_path = metadata_path_for(upload_id)
    if not archive_path.exists() or not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    owner_user_id = str(meta.get("owner_user_id") or "").strip()
    if not owner_user_id:
        return None
    original_filename = str(meta.get("original_filename") or archive_path.name)
    stored_filename = str(meta.get("stored_filename") or archive_path.name)
    size = int(meta.get("size") or archive_path.stat().st_size)
    created_at = str(meta.get("created_at") or "")
    return UploadRecord(
        upload_id=upload_id,
        owner_user_id=owner_user_id,
        original_filename=original_filename,
        stored_filename=stored_filename,
        archive_path=archive_path,
        metadata_path=meta_path,
        size=size,
        created_at=created_at,
    )
