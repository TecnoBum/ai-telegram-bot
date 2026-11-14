#!/usr/bin/env python3
"""Despliega ai-telegram-bot en Vercel (proyecto ai-telegram-bot).
Durable: vive en el repo, no en /tmp.
Uso: python3 deploy.py
- Lee el id del proyecto de vercel-project.json (se crea tras create_project).
- Sube cada archivo con upload_file (sha1 + base64) validando la respuesta
  INTERNA de cada subida, y crea el deployment con el manifiesto.
- Escribe el id del deployment en last_deployment.txt.
- Las env vars (TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, llaves de IA) se ponen
  aparte con create_project_env, NO van en los archivos.
Excluye .env*, scripts y notas.
"""
import base64, hashlib, json, subprocess, sys, os

CLI = "/opt/hatch/bin/vercel"
ROOT = os.path.dirname(os.path.abspath(__file__))
INCLUDE_FILES = ["package.json", "vercel.json", "api/index.js", "api/webhook.js"]


def call(name, args):
    p = subprocess.run([CLI, "call-tool", "--name", name,
                        "--arguments-json", json.dumps(args)],
                       capture_output=True, text=True)
    try:
        outer = json.loads(p.stdout.strip())
    except Exception:
        print("SALIDA SIN JSON de", name, ":", p.stdout[:800], p.stderr[:800])
        sys.exit(1)
    if not outer.get("ok"):
        print("FALLO EXTERNO en", name, ":", json.dumps(outer)[:800])
        sys.exit(1)
    try:
        inner = json.loads(outer["result"]["content"][0]["text"])
    except Exception:
        print("SIN TEXTO INTERNO en", name, ":", json.dumps(outer)[:800])
        sys.exit(1)
    return inner


def find_deployment_id(inner):
    for path in (("result", "deployment", "id"), ("result", "id"),
                 ("deployment", "id"), ("id",)):
        cur = inner
        try:
            for k in path:
                cur = cur[k]
            if isinstance(cur, str) and cur:
                return cur
        except (KeyError, TypeError):
            continue
    return None


def main():
    proj_file = os.path.join(ROOT, "vercel-project.json")
    if not os.path.exists(proj_file):
        print("Falta vercel-project.json con {\"projectId\": \"prj_...\"}")
        sys.exit(1)
    project = json.load(open(proj_file))["projectId"]
    manifest = []
    for rel in INCLUDE_FILES:
        path = os.path.join(ROOT, rel)
        data = open(path, "rb").read()
        sha = hashlib.sha1(data).hexdigest()
        inner = call("upload_file", {
            "xVercelDigest": sha,
            "contentLength": len(data),
            "requestBody": base64.b64encode(data).decode(),
        })
        res = inner.get("result", inner)
        if isinstance(res, dict) and res.get("error"):
            print(f"SUBIDA FALLIDA {rel}: {json.dumps(res)[:500]}")
            sys.exit(1)
        manifest.append({"file": rel, "sha": sha, "size": len(data)})
        print(f"subido {rel} ({len(data)} B)")
    print("creando deployment...")
    dep = call("create_deployment", {"requestBody": {
        "name": "ai-telegram-bot",
        "project": project,
        "target": "production",
        "files": manifest,
    }})
    did = find_deployment_id(dep)
    print("deploy:", json.dumps(dep)[:600])
    if not did:
        print("NO SE ENCONTRÓ EL ID DEL DEPLOYMENT")
        sys.exit(1)
    print("DPL:" + did)
    open(os.path.join(ROOT, "last_deployment.txt"), "w").write(did + "\n")


if __name__ == "__main__":
    main()
