#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const envPath = path.resolve(process.cwd(), ".env");

function parseEnv(content) {
  const result = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function logStatus(ok, label, advice) {
  const icon = ok ? "✅" : "⚠️";
  console.log(`${icon} ${label}`);
  if (!ok && advice) {
    console.log(`   → ${advice}`);
  }
}

function checkUrl(variable, value, { requiredPath, defaultInfo } = {}) {
  if (!value) {
    if (defaultInfo) {
      logStatus(true, `${variable} non défini (utilisation par défaut de ${defaultInfo}).`);
      console.log(
        `   → Définissez ${variable} uniquement si votre frontend doit contacter une URL différente (reverse proxy, domaine public, etc.).`,
      );
    } else {
      logStatus(
        false,
        `${variable} n'est pas défini.`,
        "Ajoutez cette variable dans votre .env si vous exposez le composant correspondant.",
      );
    }
    return;
  }

  try {
    const parsed = new URL(value);
    logStatus(true, `${variable} → ${parsed.href}`);
    if (requiredPath && !parsed.pathname.endsWith(requiredPath)) {
      logStatus(
        false,
        `${variable} ne pointe pas vers un endpoint se terminant par ${requiredPath}.`,
        `Vérifiez que l'URL cible inclut bien le chemin ${requiredPath} (ex. https://example.com${requiredPath}).`,
      );
    }
  } catch (error) {
    logStatus(false, `${variable} → valeur invalide (${value}).`, "Utilisez une URL complète, par exemple https://chatkit.example.com/api/chatkit.");
  }
}

function sanitizeEnvName(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed === "" ? "" : trimmed;
}

function getEnvValue(env, key) {
  if (!key) {
    return "";
  }
  const value = env[key];
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed === "" ? "" : trimmed;
}

function validateOpenAIKey(variable, value) {
  if (!value) {
    logStatus(
      false,
      `${variable} manquante.`,
      `Renseignez la clé API fournie dans la console OpenAI (accès ChatKit requis) via ${variable}.`,
    );
    return;
  }

  if (!value.startsWith("sk-") && !value.startsWith("sk-proj-")) {
    logStatus(
      false,
      `${variable} ne ressemble pas à une clé valide.`,
      "Les clés commencent généralement par sk- ou sk-proj-.",
    );
    return;
  }

  if (value.includes("your-openai-api-key")) {
    logStatus(
      false,
      `${variable} utilise encore la valeur d'exemple.`,
      "Remplacez-la par votre véritable clé API.",
    );
    return;
  }

  logStatus(true, `${variable} semble correctement renseignée.`);
}

function validateDatabaseUrl(value) {
  if (!value) {
    logStatus(
      false,
      "DATABASE_URL non défini.",
      "Ajoutez un DSN de base de données (ex. postgresql+psycopg://user:pass@host:5432/db ou sqlite:///./chatkit.db).",
    );
    return;
  }

  const protocolMatch = value.match(/^([a-z][a-z0-9+.-]*)/i);
  if (!protocolMatch) {
    logStatus(
      false,
      `DATABASE_URL → format inattendu (${value}).`,
      "Utilisez un DSN SQLAlchemy valide, par exemple postgresql+psycopg://user:pass@host:5432/db.",
    );
    return;
  }

  const driver = protocolMatch[1];
  logStatus(true, `DATABASE_URL défini (driver ${driver}).`);
}

function main() {
  console.log("🔍 Diagnostic du fichier .env\n");

  if (!fs.existsSync(envPath)) {
    console.error("❌ Aucun fichier .env trouvé à la racine du dépôt.");
    console.error("   → Dupliquez .env.example en .env puis relancez ce script.");
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, "utf8");
  const env = parseEnv(content);

  const provider = sanitizeEnvName(env.MODEL_PROVIDER) || "openai";
  const normalizedProvider = provider.toLowerCase();
  logStatus(true, `MODEL_PROVIDER → ${provider}`);

  const explicitModelApiBase = sanitizeEnvName(env.MODEL_API_BASE);
  const explicitModelApiKeyEnv = sanitizeEnvName(env.MODEL_API_KEY_ENV);
  const keyEnv =
    explicitModelApiKeyEnv
      || (normalizedProvider === "openai"
        ? "OPENAI_API_KEY"
        : normalizedProvider === "litellm"
          ? "LITELLM_API_KEY"
          : "");

  if (normalizedProvider === "openai") {
    if (explicitModelApiBase) {
      logStatus(true, `MODEL_API_BASE → ${explicitModelApiBase}`);
    } else if (env.CHATKIT_API_BASE) {
      const chatkitBase = sanitizeEnvName(env.CHATKIT_API_BASE);
      if (chatkitBase) {
        logStatus(true, `CHATKIT_API_BASE → ${chatkitBase}`);
      }
    }

    if (explicitModelApiKeyEnv) {
      logStatus(true, `MODEL_API_KEY_ENV → ${explicitModelApiKeyEnv}`);
    }

    const keyValue = getEnvValue(env, keyEnv);
    validateOpenAIKey(keyEnv, keyValue);
  } else if (normalizedProvider === "litellm") {
    if (explicitModelApiBase) {
      logStatus(true, `MODEL_API_BASE → ${explicitModelApiBase}`);
    } else {
      const litellmBase = sanitizeEnvName(env.LITELLM_API_BASE);
      if (litellmBase) {
        logStatus(true, `LITELLM_API_BASE → ${litellmBase}`);
      } else {
        logStatus(
          false,
          "LITELLM_API_BASE manquante.",
          "Définissez LITELLM_API_BASE (ex. http://localhost:4000) lorsque MODEL_PROVIDER=litellm.",
        );
      }
    }

    if (explicitModelApiKeyEnv) {
      logStatus(true, `MODEL_API_KEY_ENV → ${explicitModelApiKeyEnv}`);
    }

    if (!keyEnv) {
      logStatus(
        false,
        "MODEL_API_KEY_ENV non défini.",
        "Précisez la variable contenant la clé de votre proxy LiteLLM (ex. MODEL_API_KEY_ENV=LITELLM_API_KEY).",
      );
    } else {
      const proxyKey = getEnvValue(env, keyEnv);
      if (!proxyKey) {
        logStatus(
          false,
          `${keyEnv} manquante.`,
          "Ajoutez la clé API partagée utilisée pour sécuriser votre proxy LiteLLM.",
        );
      } else {
        logStatus(true, `${keyEnv} détectée.`);
      }
    }

    const masterKey = sanitizeEnvName(env.LITELLM_MASTER_KEY);
    if (!masterKey) {
      logStatus(
        false,
        "LITELLM_MASTER_KEY manquante.",
        "Renseignez la master key configurée côté LiteLLM (généralement identique à LITELLM_API_KEY).",
      );
    } else {
      logStatus(true, "LITELLM_MASTER_KEY détectée.");
    }

    const storeModelRaw = sanitizeEnvName(env.STORE_MODEL_IN_DB);
    const wantsDbStorage = storeModelRaw && storeModelRaw.toLowerCase() === "true";
    if (storeModelRaw) {
      if (storeModelRaw.toLowerCase() === "true" || storeModelRaw.toLowerCase() === "false") {
        logStatus(true, `STORE_MODEL_IN_DB=${storeModelRaw}`);
      } else {
        logStatus(
          false,
          `STORE_MODEL_IN_DB=${storeModelRaw} non reconnu.`,
          "Utilisez True ou False selon que vous voulez persister les modèles LiteLLM dans la base.",
        );
      }
    } else {
      logStatus(true, "STORE_MODEL_IN_DB non défini (le proxy ne stockera pas les modèles en base).");
    }

    const fallbackLiteLLMDsn = "postgresql://postgres:postgres@litellmdb:5432/litellm";
    const litellmRaw = sanitizeEnvName(env.LITELLM_DATABASE_URL);
    const databaseUrlRaw = sanitizeEnvName(env.DATABASE_URL);
    const litellmDbUrl = litellmRaw
      || (/^postgres(?:ql)?:\/\//i.test(databaseUrlRaw) ? databaseUrlRaw : "");
    if (wantsDbStorage) {
      if (!litellmDbUrl) {
        logStatus(
          true,
          `Aucun DSN LiteLLM explicite dans ce fichier : docker/litellm/.env fournit DATABASE_URL=${fallbackLiteLLMDsn} et l'entrypoint applique cette valeur pour Prisma.`,
        );
        console.log(
          "   → Ajustez docker/litellm/.env (variables DATABASE_URL et éventuellement LITELLM_DATABASE_URL) si vous externalisez la base LiteLLM ou si vous changez les identifiants du service litellmdb.",
        );
      } else if (!/^postgres(?:ql)?:\/\//i.test(litellmDbUrl)) {
        logStatus(
          false,
          `DSN LiteLLM → format inattendu (${litellmDbUrl}).`,
          "LiteLLM (Prisma) attend un DSN commençant par postgresql:// ou postgres://. Mettez à jour docker/litellm/.env ou laissez l'entrypoint utiliser sa valeur par défaut.",
        );
      } else {
        if (litellmDbUrl === fallbackLiteLLMDsn) {
          logStatus(true, "DATABASE_URL/LITELLM_DATABASE_URL → utilisation du DSN LiteLLM fourni par docker-compose.");
        } else {
          logStatus(true, "DATABASE_URL/LITELLM_DATABASE_URL personnalisé détecté pour LiteLLM.");
        }
      }
    } else if (litellmDbUrl) {
      if (!/^postgres(?:ql)?:\/\//i.test(litellmDbUrl)) {
        logStatus(
          false,
          `DSN LiteLLM → format inattendu (${litellmDbUrl}).`,
          "LiteLLM (Prisma) attend un DSN commençant par postgresql:// ou postgres://. Supprimez la valeur ou remplacez-la.",
        );
      } else if (litellmDbUrl === fallbackLiteLLMDsn) {
        logStatus(true, "DATABASE_URL/LITELLM_DATABASE_URL → utilisation du DSN LiteLLM fourni par docker-compose.");
      } else {
        logStatus(true, "DATABASE_URL/LITELLM_DATABASE_URL personnalisé détecté (persistance optionnelle prête).");
      }
    } else {
      logStatus(
        true,
        `Aucun DSN LiteLLM dans ce fichier : la pile docker/litellm utilise DATABASE_URL=${fallbackLiteLLMDsn} par défaut via son entrypoint.`,
      );
    }

    const saltKey = sanitizeEnvName(env.LITELLM_SALT_KEY);
    if (wantsDbStorage) {
      if (!saltKey) {
        logStatus(
          false,
          "LITELLM_SALT_KEY manquante alors que STORE_MODEL_IN_DB=True.",
          "Définissez LITELLM_SALT_KEY avant le premier démarrage du proxy (valeur immuable).",
        );
      } else {
        logStatus(true, "LITELLM_SALT_KEY détectée.");
      }
    } else if (saltKey) {
      logStatus(true, "LITELLM_SALT_KEY détectée (stockage en base optionnel).");
    }

    const renderPort = sanitizeEnvName(env.PORT);
    if (renderPort) {
      logStatus(true, `PORT → ${renderPort}`);
    }

    console.log(
      "   → Pensez à exposer ANTHROPIC_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, etc. selon les modèles déclarés côté LiteLLM.",
    );
  } else {
    if (explicitModelApiBase) {
      logStatus(true, `MODEL_API_BASE → ${explicitModelApiBase}`);
    } else {
      logStatus(
        false,
        "MODEL_API_BASE non défini.",
        "Indiquez l'URL de base de votre fournisseur compatible OpenAI via MODEL_API_BASE.",
      );
    }

    if (explicitModelApiKeyEnv) {
      logStatus(true, `MODEL_API_KEY_ENV → ${explicitModelApiKeyEnv}`);
    }

    if (!keyEnv) {
      logStatus(
        false,
        "MODEL_API_KEY_ENV non défini.",
        "Renseignez MODEL_API_KEY_ENV pour indiquer la variable qui contient votre clé API fournisseur.",
      );
    } else {
      const providerKey = getEnvValue(env, keyEnv);
      if (!providerKey) {
        logStatus(
          false,
          `${keyEnv} manquante.`,
          `Ajoutez la clé API référencée par MODEL_API_KEY_ENV (${keyEnv}).`,
        );
      } else {
        logStatus(true, `${keyEnv} détectée.`);
      }
    }
  }

  validateDatabaseUrl(sanitizeEnvName(env.DATABASE_URL));

  const origins = env.ALLOWED_ORIGINS;
  if (origins) {
    logStatus(true, `ALLOWED_ORIGINS → ${origins}`);
  } else {
    logStatus(false, "ALLOWED_ORIGINS non défini.", "Ajoutez les origines frontends autorisées ou laissez '*' pour le développement.");
  }

  checkUrl("VITE_BACKEND_URL", env.VITE_BACKEND_URL, { requiredPath: "/api" });
  checkUrl("VITE_CHATKIT_API_URL", env.VITE_CHATKIT_API_URL, {
    requiredPath: "/api/chatkit",
    defaultInfo: "'/api/chatkit'",
  });

  const uploadStrategy = env.VITE_CHATKIT_UPLOAD_STRATEGY;
  if (uploadStrategy) {
    const normalized = uploadStrategy.toLowerCase();
    if (normalized !== "two_phase" && normalized !== "two-phase" && normalized !== "direct") {
      logStatus(false, `VITE_CHATKIT_UPLOAD_STRATEGY=${uploadStrategy} non reconnu.`, "Utilisez 'two_phase' ou 'direct'.");
    } else {
      logStatus(true, `VITE_CHATKIT_UPLOAD_STRATEGY=${uploadStrategy}`);
      if (normalized === "direct" && !env.VITE_CHATKIT_DIRECT_UPLOAD_URL) {
        logStatus(false, "VITE_CHATKIT_DIRECT_UPLOAD_URL manquante pour la stratégie direct.", "Définissez l'URL d'upload direct ou basculez sur la stratégie two_phase.");
      }
    }
  } else {
    logStatus(false, "VITE_CHATKIT_UPLOAD_STRATEGY non défini.", "Les pièces jointes resteront désactivées tant qu'aucune stratégie n'est spécifiée.");
  }

  if (env.VITE_CHATKIT_DOMAIN_KEY) {
    logStatus(true, "VITE_CHATKIT_DOMAIN_KEY détectée.");
  } else {
    logStatus(
      false,
      "VITE_CHATKIT_DOMAIN_KEY non défini.",
      "Sur un domaine personnalisé, récupérez la clé dans la console OpenAI (section Domain keys) et ajoutez-la pour éviter que le widget ne se masque.",
    );
  }

  if (env.VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION?.toLowerCase() === "true") {
    logStatus(
      true,
      "VITE_CHATKIT_SKIP_DOMAIN_VERIFICATION activé.",
      "La vérification distante sera ignorée : conservez ce réglage uniquement en développement.",
    );
  }

  if (env.VITE_CHATKIT_FORCE_HOSTED?.toLowerCase() === "true") {
    logStatus(false, "VITE_CHATKIT_FORCE_HOSTED activé.", "Désactivez cette variable pour utiliser votre serveur auto-hébergé.");
  }

  if (env.VITE_HMR_HOST) {
    logStatus(true, `VITE_HMR_HOST → ${env.VITE_HMR_HOST}`);
  }

  console.log("\n📌 En cas d'erreur 502, vérifiez que l'URL configurée répond bien avec un simple curl :");
  console.log("   curl -i " + (env.VITE_CHATKIT_API_URL || "https://votre-domaine/api/chatkit"));
  console.log("\nDiagnostic terminé.");
}

main();
