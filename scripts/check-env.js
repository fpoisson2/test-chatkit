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

function main() {
  console.log("🔍 Diagnostic du fichier .env\n");

  if (!fs.existsSync(envPath)) {
    console.error("❌ Aucun fichier .env trouvé à la racine du dépôt.");
    console.error("   → Dupliquez .env.example en .env puis relancez ce script.");
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, "utf8");
  const env = parseEnv(content);

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    logStatus(false, "OPENAI_API_KEY manquante.", "Renseignez la clé API fournie dans la console OpenAI (accès ChatKit requis).");
  } else if (!apiKey.startsWith("sk-")) {
    logStatus(false, "OPENAI_API_KEY ne ressemble pas à une clé valide.", "Les clés commencent généralement par sk- ou sk-proj-.");
  } else if (apiKey.includes("your-openai-api-key")) {
    logStatus(false, "OPENAI_API_KEY utilise encore la valeur d'exemple.", "Remplacez-la par votre véritable clé API.");
  } else {
    logStatus(true, "OPENAI_API_KEY semble correctement renseignée.");
  }

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
