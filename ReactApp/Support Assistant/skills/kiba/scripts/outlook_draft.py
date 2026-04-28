#!/usr/bin/env python3
import argparse
import json
import os
import stat
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_TENANT_ID = "26dce9f0-a8ed-4298-8698-a1f6655f9111"
DEFAULT_CLIENT_ID = "d223c301-27d0-4a42-b591-641e0e7ea4da"
DEFAULT_SCOPE = "openid profile offline_access User.Read Mail.ReadWrite"
DEFAULT_TOKEN_PATH = os.path.expanduser("~/.config/codex/outlook_rw_token.json")
GRAPH = "https://graph.microsoft.com/v1.0"


def post_form(url, data):
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def graph_request(token, method, path, payload=None, params=None):
    url = GRAPH + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = None
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode("utf-8")
        if not raw:
            return {}
        return json.loads(raw)


def ensure_parent(path):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)


def save_token(path, obj):
    ensure_parent(path)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def load_token(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def token_endpoint(tenant_id):
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"


def devicecode_endpoint(tenant_id):
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/devicecode"


def login_device_flow(tenant_id, client_id, scope, token_path):
    dc = post_form(devicecode_endpoint(tenant_id), {"client_id": client_id, "scope": scope})
    print(dc.get("message", ""))
    interval = int(dc.get("interval", 5))
    expires_in = int(dc.get("expires_in", 900))
    start = time.time()

    while time.time() - start < expires_in:
        time.sleep(interval)
        try:
            tok = post_form(
                token_endpoint(tenant_id),
                {
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": client_id,
                    "device_code": dc["device_code"],
                },
            )
            if "access_token" in tok:
                tok["obtained_at"] = int(time.time())
                save_token(token_path, tok)
                print(f"Token saved: {token_path}")
                return tok
            err = tok.get("error")
            if err == "slow_down":
                interval += 2
            if err not in ("authorization_pending", "slow_down"):
                print(json.dumps(tok, ensure_ascii=False))
                raise SystemExit(1)
        except urllib.error.HTTPError as e:
            payload = e.read().decode("utf-8", errors="replace")
            try:
                obj = json.loads(payload)
            except Exception:
                print(payload)
                raise SystemExit(1)
            err = obj.get("error")
            if err in ("authorization_pending", "slow_down"):
                if err == "slow_down":
                    interval += 2
                continue
            print(json.dumps(obj, ensure_ascii=False))
            raise SystemExit(1)

    raise SystemExit("Authentication timeout")


def refresh_access_token(tenant_id, client_id, token_path):
    tok = load_token(token_path)
    if not tok or "refresh_token" not in tok:
        return None
    try:
        new_tok = post_form(
            token_endpoint(tenant_id),
            {
                "grant_type": "refresh_token",
                "client_id": client_id,
                "refresh_token": tok["refresh_token"],
            },
        )
    except urllib.error.HTTPError as e:
        payload = e.read().decode("utf-8", errors="replace")
        try:
            obj = json.loads(payload)
        except Exception:
            return None
        if obj.get("error") in ("invalid_grant", "interaction_required"):
            return None
        raise
    if "access_token" not in new_tok:
        return None
    if "refresh_token" not in new_tok:
        new_tok["refresh_token"] = tok["refresh_token"]
    new_tok["obtained_at"] = int(time.time())
    save_token(token_path, new_tok)
    return new_tok


def get_access_token(tenant_id, client_id, scope, token_path):
    tok = refresh_access_token(tenant_id, client_id, token_path)
    if tok:
        return tok["access_token"]
    raise SystemExit(
        f"No valid RW token at {token_path}. Run login first: "
        f"outlook_draft.py login --scope '{scope}' --token-path {token_path}"
    )


def parse_recipients(value):
    if not value:
        return []
    return [
        {"emailAddress": {"address": x.strip()}}
        for x in value.split(",")
        if x.strip()
    ]


def load_body(args):
    body = args.body_html
    if args.body_file:
        with open(args.body_file, "r", encoding="utf-8") as f:
            body = f.read()
    if not body:
        raise SystemExit("Provide --body-html or --body-file.")
    return body


def encode_message_id(message_id):
    return urllib.parse.quote(message_id, safe="")


def cmd_me(token):
    me = graph_request(token, "GET", "/me", params={"$select": "displayName,mail,userPrincipalName"})
    print(json.dumps(me, ensure_ascii=False, indent=2))


def cmd_draft(token, args):
    body = load_body(args)
    payload = {
        "subject": args.subject,
        "body": {"contentType": "HTML", "content": body},
        "toRecipients": parse_recipients(args.to),
        "ccRecipients": parse_recipients(args.cc),
        "bccRecipients": parse_recipients(args.bcc),
    }
    payload = {k: v for k, v in payload.items() if v}
    msg = graph_request(token, "POST", "/me/messages", payload=payload)
    out = {
        "id": msg.get("id"),
        "subject": msg.get("subject"),
        "webLink": msg.get("webLink"),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_reply_all(token, args):
    if not args.message_id:
        raise SystemExit("Provide --message-id for reply-all.")
    body = load_body(args)
    encoded_id = encode_message_id(args.message_id)
    created = graph_request(token, "POST", f"/me/messages/{encoded_id}/createReplyAll", payload={"comment": ""})
    draft_id = created.get("id")
    if not draft_id:
        raise SystemExit("Failed to create reply-all draft.")

    patch_payload = {"body": {"contentType": "HTML", "content": body}}
    if args.bcc:
        patch_payload["bccRecipients"] = parse_recipients(args.bcc)
    graph_request(token, "PATCH", f"/me/messages/{encode_message_id(draft_id)}", payload=patch_payload)
    msg = graph_request(token, "GET", f"/me/messages/{encode_message_id(draft_id)}")
    out = {
        "id": msg.get("id"),
        "subject": msg.get("subject"),
        "webLink": msg.get("webLink"),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser(description="Outlook draft helper (RW token)")
    p.add_argument("command", choices=["login", "me", "draft", "reply-all"])
    p.add_argument("--tenant-id", default=os.environ.get("MS_TENANT_ID", DEFAULT_TENANT_ID))
    p.add_argument("--client-id", default=os.environ.get("MS_CLIENT_ID", DEFAULT_CLIENT_ID))
    p.add_argument("--scope", default=os.environ.get("MS_SCOPE_RW", DEFAULT_SCOPE))
    p.add_argument("--token-path", default=os.environ.get("OUTLOOK_RW_TOKEN_PATH", DEFAULT_TOKEN_PATH))
    p.add_argument("--subject", default="")
    p.add_argument("--to", default="")
    p.add_argument("--cc", default="")
    p.add_argument("--bcc", default="")
    p.add_argument("--body-html", default="")
    p.add_argument("--body-file", default="")
    p.add_argument("--message-id", default="")
    args = p.parse_args()

    if args.command == "login":
        login_device_flow(args.tenant_id, args.client_id, args.scope, args.token_path)
        return

    token = get_access_token(args.tenant_id, args.client_id, args.scope, args.token_path)
    if args.command == "me":
        cmd_me(token)
    elif args.command == "draft":
        cmd_draft(token, args)
    elif args.command == "reply-all":
        cmd_reply_all(token, args)


if __name__ == "__main__":
    main()
