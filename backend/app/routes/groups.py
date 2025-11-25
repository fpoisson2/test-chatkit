"""Routes pour la gestion des groupes d'utilisateurs (ACL)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user, require_teacher_or_admin
from ..models import User, UserGroup, UserGroupMember, WorkflowGroupShare
from ..schemas import (
    UserGroupCreateRequest,
    UserGroupDetailResponse,
    UserGroupMemberAddRequest,
    UserGroupMemberResponse,
    UserGroupMemberUpdateRequest,
    UserGroupResponse,
    UserGroupUpdateRequest,
)

router = APIRouter()


def _serialize_group(group: UserGroup, members_count: int = 0) -> dict:
    """Sérialise un groupe pour la réponse."""
    return {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "owner_id": group.owner_id,
        "owner_email": group.owner.email if group.owner else None,
        "members_count": members_count,
        "created_at": group.created_at,
        "updated_at": group.updated_at,
    }


def _serialize_member(member: UserGroupMember) -> dict:
    """Sérialise un membre de groupe pour la réponse."""
    return {
        "id": member.id,
        "user_id": member.user_id,
        "email": member.user.email if member.user else "",
        "role": member.role,
        "created_at": member.created_at,
    }


def _ensure_group_access(
    group: UserGroup, user: User, require_admin: bool = False
) -> None:
    """Vérifie que l'utilisateur a accès au groupe.

    Args:
        group: Le groupe à vérifier
        user: L'utilisateur courant
        require_admin: Si True, nécessite d'être owner ou admin du groupe
    """
    if user.is_admin:
        return

    if group.owner_id == user.id:
        return

    # Vérifier si l'utilisateur est membre du groupe
    for member in group.members:
        if member.user_id == user.id:
            if require_admin and member.role != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Vous n'avez pas les droits d'administration sur ce groupe",
                )
            return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Vous n'avez pas accès à ce groupe",
    )


# ============================================================================
# Group CRUD
# ============================================================================


@router.get("/api/groups", response_model=list[UserGroupResponse])
async def list_groups(
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> list[UserGroupResponse]:
    """Liste les groupes accessibles à l'utilisateur.

    - Admin: tous les groupes
    - Teacher: groupes dont il est owner ou membre
    """
    if current_user.is_admin:
        groups = session.query(UserGroup).all()
    else:
        # Groupes dont l'utilisateur est owner
        owned_groups = session.query(UserGroup).filter(
            UserGroup.owner_id == current_user.id
        ).all()

        # Groupes dont l'utilisateur est membre
        member_group_ids = session.query(UserGroupMember.group_id).filter(
            UserGroupMember.user_id == current_user.id
        ).subquery()

        member_groups = session.query(UserGroup).filter(
            UserGroup.id.in_(member_group_ids)
        ).all()

        # Fusionner et dédupliquer
        group_ids = set()
        groups = []
        for g in owned_groups + member_groups:
            if g.id not in group_ids:
                group_ids.add(g.id)
                groups.append(g)

    result = []
    for group in groups:
        members_count = session.query(func.count(UserGroupMember.id)).filter(
            UserGroupMember.group_id == group.id
        ).scalar() or 0
        result.append(UserGroupResponse.model_validate(_serialize_group(group, members_count)))

    return result


@router.post("/api/groups", response_model=UserGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    request: UserGroupCreateRequest,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> UserGroupResponse:
    """Crée un nouveau groupe d'utilisateurs."""
    group = UserGroup(
        name=request.name,
        description=request.description,
        owner_id=current_user.id,
    )
    session.add(group)
    session.commit()
    session.refresh(group)

    return UserGroupResponse.model_validate(_serialize_group(group, 0))


@router.get("/api/groups/{group_id}", response_model=UserGroupDetailResponse)
async def get_group(
    group_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> UserGroupDetailResponse:
    """Récupère les détails d'un groupe avec ses membres."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    _ensure_group_access(group, current_user)

    members = [_serialize_member(m) for m in group.members]

    return UserGroupDetailResponse.model_validate({
        **_serialize_group(group, len(members)),
        "members": members,
    })


@router.patch("/api/groups/{group_id}", response_model=UserGroupResponse)
async def update_group(
    group_id: int,
    request: UserGroupUpdateRequest,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> UserGroupResponse:
    """Met à jour un groupe (nom, description)."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    _ensure_group_access(group, current_user, require_admin=True)

    if request.name is not None:
        group.name = request.name
    if request.description is not None:
        group.description = request.description

    session.commit()
    session.refresh(group)

    members_count = session.query(func.count(UserGroupMember.id)).filter(
        UserGroupMember.group_id == group.id
    ).scalar() or 0

    return UserGroupResponse.model_validate(_serialize_group(group, members_count))


@router.delete("/api/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    group_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> None:
    """Supprime un groupe."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    # Seul le owner ou un admin peut supprimer
    if not current_user.is_admin and group.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Seul le propriétaire du groupe peut le supprimer",
        )

    session.delete(group)
    session.commit()


# ============================================================================
# Group Members
# ============================================================================


@router.post("/api/groups/{group_id}/members", response_model=UserGroupMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_group_member(
    group_id: int,
    request: UserGroupMemberAddRequest,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> UserGroupMemberResponse:
    """Ajoute un membre au groupe."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    _ensure_group_access(group, current_user, require_admin=True)

    # Vérifier que l'utilisateur existe
    user = session.query(User).filter(User.id == request.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utilisateur non trouvé",
        )

    # Vérifier que l'utilisateur n'est pas déjà membre
    existing = session.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == request.user_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="L'utilisateur est déjà membre du groupe",
        )

    member = UserGroupMember(
        group_id=group_id,
        user_id=request.user_id,
        role=request.role,
    )
    session.add(member)
    session.commit()
    session.refresh(member)

    return UserGroupMemberResponse.model_validate(_serialize_member(member))


@router.patch("/api/groups/{group_id}/members/{user_id}", response_model=UserGroupMemberResponse)
async def update_group_member(
    group_id: int,
    user_id: int,
    request: UserGroupMemberUpdateRequest,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> UserGroupMemberResponse:
    """Met à jour le rôle d'un membre du groupe."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    _ensure_group_access(group, current_user, require_admin=True)

    member = session.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user_id,
    ).first()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membre non trouvé dans ce groupe",
        )

    member.role = request.role
    session.commit()
    session.refresh(member)

    return UserGroupMemberResponse.model_validate(_serialize_member(member))


@router.delete("/api/groups/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_group_member(
    group_id: int,
    user_id: int,
    current_user: User = Depends(require_teacher_or_admin),
    session: Session = Depends(get_session),
) -> None:
    """Retire un membre du groupe."""
    group = session.query(UserGroup).filter(UserGroup.id == group_id).first()
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Groupe non trouvé",
        )

    _ensure_group_access(group, current_user, require_admin=True)

    member = session.query(UserGroupMember).filter(
        UserGroupMember.group_id == group_id,
        UserGroupMember.user_id == user_id,
    ).first()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Membre non trouvé dans ce groupe",
        )

    session.delete(member)
    session.commit()
