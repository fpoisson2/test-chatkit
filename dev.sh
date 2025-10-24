#!/bin/bash

# Script de développement - Lance frontend, backend et base de données
set -e

# Couleurs pour les logs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Démarrage de l'environnement de développement...${NC}"

# Fonction de nettoyage
cleanup() {
    echo -e "\n${YELLOW}🛑 Arrêt des services...${NC}"

    # Arrêter les processus en arrière-plan
    if [ ! -z "$BACKEND_PID" ]; then
        echo -e "${YELLOW}Arrêt du backend (PID: $BACKEND_PID)${NC}"
        kill $BACKEND_PID 2>/dev/null || true
    fi

    if [ ! -z "$FRONTEND_PID" ]; then
        echo -e "${YELLOW}Arrêt du frontend (PID: $FRONTEND_PID)${NC}"
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    # Optionnel: arrêter la DB (décommentez si vous voulez l'arrêter aussi)
    # echo -e "${YELLOW}Arrêt de la base de données${NC}"
    # docker-compose stop db

    echo -e "${GREEN}✅ Services arrêtés${NC}"
    exit 0
}

# Capturer Ctrl+C
trap cleanup SIGINT SIGTERM

# 1. Démarrer la base de données
echo -e "${BLUE}📦 Démarrage de PostgreSQL...${NC}"
docker-compose up -d db

# Attendre que la DB soit prête
echo -e "${YELLOW}⏳ Attente de la base de données...${NC}"
until docker-compose exec -T db pg_isready -U chatkit > /dev/null 2>&1; do
    sleep 1
done
echo -e "${GREEN}✅ Base de données prête${NC}"

# 2. Démarrer le backend
echo -e "${BLUE}🐍 Démarrage du backend (uvicorn)...${NC}"
cd backend
uv run --env-file ../.env uvicorn server:app --reload --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
cd ..
echo -e "${GREEN}✅ Backend démarré (PID: $BACKEND_PID) - logs: logs/backend.log${NC}"

# Attendre que le backend soit prêt
echo -e "${YELLOW}⏳ Attente du backend...${NC}"
sleep 3

# 3. Démarrer le frontend
echo -e "${BLUE}⚛️  Démarrage du frontend (npm)...${NC}"
cd frontend
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..
echo -e "${GREEN}✅ Frontend démarré (PID: $FRONTEND_PID) - logs: logs/frontend.log${NC}"

echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Environnement de développement prêt!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📱 Frontend:${NC}  http://localhost:5173"
echo -e "${BLUE}🔧 Backend:${NC}   http://localhost:8000"
echo -e "${BLUE}📊 Docs API:${NC}  http://localhost:8000/docs"
echo -e "${BLUE}🗄️  Database:${NC} postgresql://chatkit:chatkit@localhost:5432/chatkit"
echo -e "\n${YELLOW}📝 Logs:${NC}"
echo -e "  Backend:  tail -f logs/backend.log"
echo -e "  Frontend: tail -f logs/frontend.log"
echo -e "\n${YELLOW}Appuyez sur Ctrl+C pour arrêter tous les services${NC}\n"

# Suivre les logs en temps réel
tail -f logs/backend.log logs/frontend.log 2>/dev/null &
TAIL_PID=$!

# Attendre indéfiniment
wait
