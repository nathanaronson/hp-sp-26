from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, SessionDep
from app.models.deployment import Deployment
from app.schemas.deployment import DeploymentCreate, DeploymentList, DeploymentRead

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
) -> Deployment:
    deployment = Deployment(
        user_id=current_user.id,
        name=payload.name,
        github_url=payload.github_url,
        upload_id=payload.upload_id,
    )
    session.add(deployment)
    await session.commit()
    await session.refresh(deployment)

    # TODO: enqueue Agent #1 (analyze) -> Agent #2 (expose ports) here.
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


@router.get("/{deployment_id}", response_model=DeploymentRead)
async def get_deployment(
    deployment_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> Deployment:
    deployment = await session.get(Deployment, deployment_id)
    if deployment is None or deployment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deployment not found")
    return deployment


@router.delete("/{deployment_id}", response_model=DeploymentRead)
async def stop_deployment(
    deployment_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> Deployment:
    deployment = await session.get(Deployment, deployment_id)
    if deployment is None or deployment.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Deployment not found")
    deployment.status = "stopped"
    await session.commit()
    await session.refresh(deployment)
    # TODO: signal the running sandbox/agent to actually tear down.
    return deployment
