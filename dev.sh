#!/bin/bash

# Script de développement - Lance frontend, backend et base de données
set -e

# Couleurs pour les logs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SETSID_BIN=$(command -v setsid 2>/dev/null || true)
SELF_PGID=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' \t\n')

echo -e "${BLUE}🚀 Démarrage de l'environnement de développement...${NC}"

# PID/PGID des processus démarrés
BACKEND_PID=""
BACKEND_PGID=""
FRONTEND_PID=""
FRONTEND_PGID=""
TAIL_PID=""
TAIL_PGID=""

# Évite les nettoyages multiples
CLEANUP_CALLED=false
DB_SHOULD_STOP=false

# Termine un processus et son groupe en douceur
kill_process_tree() {
    local pid="$1"
    local signal="$2"

    if [ -z "$pid" ]; then
        return
    fi

    if ! kill -0 -- "$pid" 2>/dev/null; then
        return
    fi

    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)

    for child in $children; do
        kill_process_tree "$child" "$signal"
    done

    if [ -n "$signal" ]; then
        kill "-$signal" "$pid" 2>/dev/null || true
    else
        kill "$pid" 2>/dev/null || true
    fi
}

stop_process_group() {
    local pid="$1"
    local pgid="$2"

    if [ -z "$pid" ]; then
        return
    fi

    if [ -z "$pgid" ]; then
        pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' \t\n')
    fi

    local use_group=false
    local target="$pid"

    if [ -n "$pgid" ]; then
        if [ -n "$SELF_PGID" ] && [ "$pgid" = "$SELF_PGID" ]; then
            pgid=""
        else
            use_group=true
            target="-$pgid"
        fi
    fi

    if ! kill -0 -- "$pid" 2>/dev/null; then
        if [ "$use_group" = true ]; then
            kill -0 -- "$target" 2>/dev/null || return
        else
            return
        fi
    fi

    if [ "$use_group" = true ]; then
        kill -TERM -- "$target" 2>/dev/null || true
    else
        kill_process_tree "$pid" "TERM"
    fi

    for _ in 1 2 3 4 5; do
        sleep 0.2
        if ! kill -0 -- "$pid" 2>/dev/null; then
            break
        fi
    done

    if kill -0 -- "$pid" 2>/dev/null; then
        if [ "$use_group" = true ]; then
            kill -KILL -- "$target" 2>/dev/null || true
        else
            kill_process_tree "$pid" "KILL"
        fi
    fi

    wait "$pid" 2>/dev/null || true
}

# Fonction de nettoyage
cleanup() {
    if [ "$CLEANUP_CALLED" = true ]; then
        return
    fi
    CLEANUP_CALLED=true

    echo -e "\n${YELLOW}🛑 Arrêt des services...${NC}"

    if [ -n "$TAIL_PID" ]; then
        echo -e "${YELLOW}Arrêt du suivi des logs (PID: $TAIL_PID)${NC}"
        stop_process_group "$TAIL_PID" "$TAIL_PGID"
    fi

    if [ -n "$BACKEND_PID" ]; then
        echo -e "${YELLOW}Arrêt du backend (PID: $BACKEND_PID)${NC}"
        stop_process_group "$BACKEND_PID" "$BACKEND_PGID"
    fi

    if [ -n "$FRONTEND_PID" ]; then
        echo -e "${YELLOW}Arrêt du frontend (PID: $FRONTEND_PID)${NC}"
        stop_process_group "$FRONTEND_PID" "$FRONTEND_PGID"
    fi

    if [ "$DB_SHOULD_STOP" = true ] && [ -n "$(docker-compose ps -q db 2>/dev/null)" ]; then
        echo -e "${YELLOW}Arrêt de la base de données${NC}"
        docker-compose stop db >/dev/null 2>&1 || true
    fi

    # Attendre la terminaison propre des processus encore présents
    if [ -n "$TAIL_PID" ]; then
        wait "$TAIL_PID" 2>/dev/null || true
    fi
    if [ -n "$BACKEND_PID" ]; then
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi

    echo -e "${GREEN}✅ Services arrêtés${NC}"
    exit 0
}

# Capturer Ctrl+C et la fermeture du script
trap cleanup SIGINT SIGTERM EXIT

# Préparer les logs
mkdir -p logs
: > logs/backend.log
: > logs/frontend.log

# 1. Démarrer la base de données
echo -e "${BLUE}📦 Démarrage de PostgreSQL...${NC}"
DB_RUNNING_BEFORE=false
DB_CONTAINER_ID=$(docker-compose ps -q db 2>/dev/null || true)
if [ -n "$DB_CONTAINER_ID" ]; then
    DB_STATE=$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER_ID" 2>/dev/null || echo "false")
    if [ "$DB_STATE" = "true" ]; then
        DB_RUNNING_BEFORE=true
    fi
fi
docker-compose up -d db
if [ "$DB_RUNNING_BEFORE" = false ]; then
    DB_SHOULD_STOP=true
fi

# Attendre que la DB soit prête
echo -e "${YELLOW}⏳ Attente de la base de données...${NC}"
until docker-compose exec -T db pg_isready -U chatkit > /dev/null 2>&1; do
    sleep 1
done
echo -e "${GREEN}✅ Base de données prête${NC}"

# 2. Démarrer le backend
echo -e "${BLUE}🐍 Démarrage du backend (uvicorn)...${NC}"
cd backend
if [ -n "$SETSID_BIN" ]; then
    "$SETSID_BIN" uv run --env-file ../.env uvicorn server:app --reload --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
else
    uv run --env-file ../.env uvicorn server:app --reload --host 0.0.0.0 --port 8000 > ../logs/backend.log 2>&1 &
fi
BACKEND_PID=$!
BACKEND_PGID=$(ps -o pgid= -p "$BACKEND_PID" 2>/dev/null | tr -d ' \t\n')
cd ..
echo -e "${GREEN}✅ Backend démarré (PID: $BACKEND_PID) - logs: logs/backend.log${NC}"

# Attendre que le backend soit prêt
echo -e "${YELLOW}⏳ Attente du backend...${NC}"
sleep 3

# 3. Démarrer le frontend
echo -e "${BLUE}⚛️  Démarrage du frontend (npm)...${NC}"
cd frontend
if [ -n "$SETSID_BIN" ]; then
    "$SETSID_BIN" npm run dev > ../logs/frontend.log 2>&1 &
else
    npm run dev > ../logs/frontend.log 2>&1 &
fi
FRONTEND_PID=$!
FRONTEND_PGID=$(ps -o pgid= -p "$FRONTEND_PID" 2>/dev/null | tr -d ' \t\n')
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
if [ -n "$SETSID_BIN" ]; then
    "$SETSID_BIN" tail -f logs/backend.log logs/frontend.log 2>/dev/null &
else
    tail -f logs/backend.log logs/frontend.log 2>/dev/null &
fi
TAIL_PID=$!
TAIL_PGID=$(ps -o pgid= -p "$TAIL_PID" 2>/dev/null | tr -d ' \t\n')

# Attendre indéfiniment
wait "$TAIL_PID"
