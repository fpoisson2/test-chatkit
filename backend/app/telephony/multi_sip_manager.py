"""Gestionnaire de registrations SIP multiples."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import SipAccount
from .registration import SIPRegistrationConfig, SIPRegistrationManager, InviteRouteHandler

logger = logging.getLogger(__name__)


class MultiSIPRegistrationManager:
    """Gère plusieurs comptes SIP simultanément.

    Cette classe maintient un SIPRegistrationManager par compte SIP actif.
    """

    def __init__(
        self,
        *,
        loop: asyncio.AbstractEventLoop | None = None,
        session_factory: Any | None = None,
        settings: Any | None = None,
        contact_host: str | None = None,
        contact_port: int | None = None,
        contact_transport: str | None = None,
        bind_host: str | None = None,
        invite_handler: InviteRouteHandler | None = None,
    ) -> None:
        """Initialise le gestionnaire multi-SIP.

        Args:
            loop: Event loop
            session_factory: Factory pour créer des sessions de base de données
            settings: Settings de l'application
            contact_host: Hôte de contact pour tous les comptes
            contact_port: Port de contact pour tous les comptes
            contact_transport: Transport (udp/tcp/tls) pour tous les comptes
            bind_host: Interface locale pour tous les comptes
            invite_handler: Handler pour les INVITE entrants
        """
        self._loop = loop or asyncio.get_event_loop()
        self._session_factory = session_factory
        self._settings = settings
        self._contact_host = contact_host
        self._contact_port = contact_port
        self._contact_transport = contact_transport
        self._bind_host = bind_host
        self._invite_handler = invite_handler

        # Dict: account_id -> SIPRegistrationManager
        self._managers: dict[int, SIPRegistrationManager] = {}

        # Compte par défaut
        self._default_account_id: int | None = None

    def set_invite_handler(self, handler: InviteRouteHandler | None) -> None:
        """Définit le handler pour tous les gestionnaires SIP."""
        self._invite_handler = handler
        for manager in self._managers.values():
            manager.set_invite_handler(handler)

    async def load_accounts_from_db(self, session: Session) -> None:
        """Charge tous les comptes SIP actifs depuis la base de données.

        Args:
            session: Session SQLAlchemy pour accéder à la BD
        """
        logger.info("Chargement des comptes SIP depuis la base de données")

        # Récupérer tous les comptes actifs
        accounts = session.scalars(
            select(SipAccount)
            .where(SipAccount.is_active == True)
            .order_by(SipAccount.is_default.desc(), SipAccount.label.asc())
        ).all()

        if not accounts:
            logger.warning("Aucun compte SIP actif trouvé dans la base de données")
            return

        logger.info("Trouvé %d compte(s) SIP actif(s)", len(accounts))

        # Créer ou mettre à jour les gestionnaires
        current_ids = set()
        for account in accounts:
            current_ids.add(account.id)

            if account.is_default:
                self._default_account_id = account.id
                logger.info("Compte SIP par défaut : %s (ID: %d)", account.label, account.id)

            # Créer la configuration SIP
            config = self._build_config_from_account(account)

            # Créer ou récupérer le gestionnaire
            if account.id not in self._managers:
                logger.info(
                    "Création d'un gestionnaire SIP pour '%s' (URI: %s)",
                    account.label,
                    account.trunk_uri,
                )
                manager = SIPRegistrationManager(
                    loop=self._loop,
                    session_factory=self._session_factory,
                    settings=self._settings,
                    contact_host=self._contact_host,
                    contact_port=self._contact_port,
                    contact_transport=self._contact_transport,
                    bind_host=self._bind_host,
                    invite_handler=self._invite_handler,
                )
                self._managers[account.id] = manager
            else:
                manager = self._managers[account.id]
                logger.info("Mise à jour du gestionnaire SIP pour '%s'", account.label)

            # Appliquer la configuration
            manager.apply_config(config)

        # Supprimer les gestionnaires pour les comptes qui n'existent plus ou sont inactifs
        removed_ids = set(self._managers.keys()) - current_ids
        for account_id in removed_ids:
            logger.info("Suppression du gestionnaire SIP pour l'ID %d", account_id)
            manager = self._managers.pop(account_id)
            # Arrêter et nettoyer
            try:
                await manager.stop()
            except Exception as exc:
                logger.exception(
                    "Erreur lors de l'arrêt du gestionnaire SIP (ID: %d)",
                    account_id,
                    exc_info=exc,
                )

    def _build_config_from_account(self, account: SipAccount) -> SIPRegistrationConfig:
        """Construit une SIPRegistrationConfig depuis un SipAccount.

        Args:
            account: Compte SIP depuis la BD

        Returns:
            Configuration SIP pour le SIPRegistrationManager
        """
        # Utiliser les valeurs du compte ou les valeurs par défaut
        contact_host = account.contact_host or self._contact_host or "127.0.0.1"
        contact_port = account.contact_port or self._contact_port or 5060
        transport = account.contact_transport or self._contact_transport
        bind_host = self._bind_host

        config = SIPRegistrationConfig(
            uri=account.trunk_uri,
            username=account.username or "",
            password=account.password or "",
            contact_host=contact_host,
            contact_port=contact_port,
            transport=transport,
            bind_host=bind_host,
        )

        return config

    async def start(self) -> None:
        """Démarre tous les gestionnaires SIP."""
        logger.info("Démarrage de tous les gestionnaires SIP (%d compte(s))", len(self._managers))

        for account_id, manager in self._managers.items():
            try:
                await manager.start()
                logger.info("Gestionnaire SIP démarré pour l'ID %d", account_id)
            except Exception as exc:
                logger.exception(
                    "Erreur lors du démarrage du gestionnaire SIP (ID: %d)",
                    account_id,
                    exc_info=exc,
                )

    async def stop(self) -> None:
        """Arrête tous les gestionnaires SIP."""
        logger.info("Arrêt de tous les gestionnaires SIP")

        for account_id, manager in self._managers.items():
            try:
                await manager.stop()
                logger.info("Gestionnaire SIP arrêté pour l'ID %d", account_id)
            except Exception as exc:
                logger.exception(
                    "Erreur lors de l'arrêt du gestionnaire SIP (ID: %d)",
                    account_id,
                    exc_info=exc,
                )

        self._managers.clear()

    def get_manager_for_account(self, account_id: int | None) -> SIPRegistrationManager | None:
        """Récupère le gestionnaire SIP pour un compte donné.

        Args:
            account_id: ID du compte SIP, ou None pour le compte par défaut

        Returns:
            Le gestionnaire SIP correspondant, ou None si non trouvé
        """
        if account_id is None:
            # Utiliser le compte par défaut
            account_id = self._default_account_id

        if account_id is None:
            # Aucun compte par défaut défini, prendre le premier disponible
            if self._managers:
                return next(iter(self._managers.values()))
            return None

        return self._managers.get(account_id)

    def get_default_manager(self) -> SIPRegistrationManager | None:
        """Récupère le gestionnaire SIP du compte par défaut.

        Returns:
            Le gestionnaire SIP par défaut, ou None
        """
        return self.get_manager_for_account(None)

    @property
    def default_account_id(self) -> int | None:
        """Retourne l'ID du compte SIP par défaut."""
        return self._default_account_id

    def has_accounts(self) -> bool:
        """Vérifie s'il y a au moins un compte SIP actif."""
        return len(self._managers) > 0
