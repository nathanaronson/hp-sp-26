from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.api.deps import CurrentUser
from app.schemas.deployment import UploadResponse
from app.services.uploads import (
    UPLOAD_MAX_BYTES,
    archive_path_for,
    new_upload_id,
    write_upload_metadata,
)

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=UploadResponse)
async def upload_code(
    file: Annotated[UploadFile, File(...)],
    current_user: CurrentUser,
) -> UploadResponse:
    """Accept a tarball / zip of the user's project directory.

    The CLI bundles the current folder, POSTs it here, and uses the returned
    `upload_id` when creating a deployment.
    """
    upload_id = new_upload_id()
    dest = archive_path_for(upload_id)

    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > UPLOAD_MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Upload too large (max {UPLOAD_MAX_BYTES // (1024 * 1024)} MB)",
                )
            out.write(chunk)
    write_upload_metadata(
        upload_id=upload_id,
        owner_user_id=current_user.id,
        original_filename=file.filename or dest.name,
        stored_filename=dest.name,
        size=size,
    )

    return UploadResponse(
        upload_id=upload_id,
        filename=file.filename or dest.name,
        size=size,
    )
