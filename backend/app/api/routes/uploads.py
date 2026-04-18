import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.schemas.deployment import UploadResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])

# Local-disk staging area. Swap for S3 later.
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


@router.post("", response_model=UploadResponse)
async def upload_code(file: Annotated[UploadFile, File(...)]) -> UploadResponse:
    """Accept a tarball / zip of the user's project directory.

    The CLI bundles the current folder, POSTs it here, and uses the returned
    `upload_id` when creating a deployment.
    """
    upload_id = uuid.uuid4().hex
    suffix = Path(file.filename or "").suffix
    dest = UPLOAD_DIR / f"{upload_id}{suffix}"

    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            out.write(chunk)
            size += len(chunk)

    return UploadResponse(
        upload_id=upload_id,
        filename=file.filename or dest.name,
        size=size,
    )
