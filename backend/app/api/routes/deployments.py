import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.models.deployment import (
    DEPLOYMENT_STATUS_STOPPED,
    AgentRun,
    Deployment,
)
from app.schemas.deployment import (
    AgentRunDetail,
    AgentRunRead,
    DeploymentCreate,
    DeploymentDetail,
    DeploymentList,
    DeploymentRead,
)
from app.services.deploy import run_deployment, teardown_deployment

log = logging.getLogger(__name__)

router = APIRouter(prefix="/deployments", tags=["deployments"])


@router.post(
    "",
    response_model=DeploymentRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_deployment(
    payload: DeploymentCreate,
    session: SessionDep,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> Deployment:
    deployment = Deployment(
        user_id=current_user.id,
        name=payload.name,
        github_url=payload.github_url,
        upload_id=payload.upload_id,
        model=payload.model,
    )
    session.add(deployment)
    await session.commit()
    await session.refresh(deployment)

    log.info(
        "POST /deployments: created %s (user=%s, name=%r, github_url=%s, upload_id=%s); scheduling orchestrator",
        deployment.id, current_user.id, payload.name, payload.github_url, payload.upload_id,
    )
    background_tasks.add_task(run_deployment, deployment.id)
    return deployment


@router.get("", response_model=DeploymentList)
async def list_deployments(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 50,
    offset: int = 0,
) -> DeploymentList:
    base = select(Deployment).where(Deployment.user_id == current_user.id)
    total = await session.scalar(
        select(func.count()).select_from(base.subquery()),
    )
    result = await session.scalars(
        base.order_by(Deployment.created_at.desc()).limit(limit).offset(offset),
    )
    items = [DeploymentRead.model_validate(d) for d in result.all()]
    return DeploymentList(items=items, total=total or 0)


@router.get("/{deployment_id}", response_model=DeploymentDetail)
async def get_deployment(
    deployment_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> DeploymentDetail:
    deployment = await session.get(Deployment, deployment_id)
    if deployment is None or deployment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deployment not found")
    runs = await session.scalars(
        select(AgentRun)
        .where(AgentRun.deployment_id == deployment_id)
        .order_by(AgentRun.created_at.asc())
    )
    detail = DeploymentDetail.model_validate(deployment)
    detail.agent_runs = [AgentRunRead.model_validate(r) for r in runs.all()]
    return detail


@router.get(
    "/{deployment_id}/agent-runs/{run_id}",
    response_model=AgentRunDetail,
)
async def get_agent_run(
    deployment_id: str,
    run_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> AgentRun:
    deployment = await session.get(Deployment, deployment_id)
    if deployment is None or deployment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deployment not found")
    run = await session.get(AgentRun, run_id)
    if run is None or run.deployment_id != deployment_id:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return run


@router.delete("/{deployment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deployment(
    deployment_id: str,
    session: SessionDep,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> None:
    deployment = await session.get(Deployment, deployment_id)
    if deployment is None or deployment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deployment not found")
    sandbox_id = deployment.sandbox_id
    log.info(
        "DELETE /deployments/%s: hard-deleting (user=%s, sandbox=%s)",
        deployment_id, current_user.id, sandbox_id,
    )
    if sandbox_id:
        background_tasks.add_task(teardown_deployment, deployment.id)
    await session.delete(deployment)
    await session.commit()
