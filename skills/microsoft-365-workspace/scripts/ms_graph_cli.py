#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import html as html_lib
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
AUTH_BASE_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0"
SCOPES = [
    "User.Read",
    "offline_access",
    "Calendars.ReadWrite",
    "Mail.ReadWrite",
    "MailboxSettings.Read",
    "Sites.ReadWrite.All",
    "Files.ReadWrite.All",
]


def default_persist_dir() -> pathlib.Path:
    raw = os.environ.get("M365_PERSIST_DIR", "./codex/persistant/token")
    return pathlib.Path(raw).expanduser()


PERSIST_DIR = default_persist_dir()
TOKEN_CACHE = pathlib.Path(os.environ.get("M365_TOKEN_CACHE", str(PERSIST_DIR / "m365_token.json"))).expanduser()
CONFIG_CACHE = pathlib.Path(os.environ.get("M365_CONFIG_CACHE", str(PERSIST_DIR / "m365_config.json"))).expanduser()


def fail(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def prompt_value(label: str, default: str | None = None) -> str:
    if not sys.stdin.isatty():
        if default is not None:
            return default
        fail(f"Missing value for {label}. Set env var or run in an interactive terminal.")

    suffix = f" [{default}]" if default else ""
    value = input(f"{label}{suffix}: ").strip()
    if value:
        return value
    if default is not None:
        return default
    fail(f"Value is required for {label}.")


def load_config() -> dict:
    if not CONFIG_CACHE.exists():
        return {}
    with CONFIG_CACHE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict) -> None:
    CONFIG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_CACHE.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def get_auth_settings(interactive: bool = True) -> tuple[str, str]:
    config = load_config()
    client_id = os.environ.get("M365_CLIENT_ID") or config.get("client_id", "")
    tenant = os.environ.get("M365_TENANT_ID") or config.get("tenant_id", "common")
    updated = False

    if not client_id:
        if not interactive:
            fail("Missing M365_CLIENT_ID and no saved config found.")
        client_id = prompt_value("Microsoft App Client ID")
        updated = True

    if not tenant:
        if not interactive:
            tenant = "common"
        else:
            tenant = prompt_value("Microsoft Tenant ID", default="common")
            updated = True

    if updated:
        config["client_id"] = client_id
        config["tenant_id"] = tenant
        save_config(config)
        print(f"Saved Microsoft auth config to {CONFIG_CACHE}")

    return client_id, tenant


def now_epoch() -> int:
    return int(time.time())


def save_token(token: dict) -> None:
    TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    token = dict(token)
    if "expires_in" in token:
        token["expires_at"] = now_epoch() + int(token["expires_in"]) - 60
    with TOKEN_CACHE.open("w", encoding="utf-8") as f:
        json.dump(token, f, indent=2)


def load_token() -> dict | None:
    if not TOKEN_CACHE.exists():
        return None
    with TOKEN_CACHE.open("r", encoding="utf-8") as f:
        return json.load(f)


def auth_base(tenant: str) -> str:
    return AUTH_BASE_TEMPLATE.format(tenant=tenant)


def post_form(url: str, data: dict) -> dict:
    encoded = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(url, data=encoded, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    return http_json(req)


def http_json(req: urllib.request.Request, expected: tuple[int, ...] = (200, 201, 202, 204)) -> dict:
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        fail(f"HTTP {e.code} {e.reason}: {body}")
    except urllib.error.URLError as e:
        fail(f"Network error: {e.reason}")

    if status not in expected:
        fail(f"Unexpected HTTP status {status}: {body}")

    if not body:
        return {}
    return json.loads(body)


def ensure_access_token(client_id: str, tenant: str) -> str:
    token = load_token()
    if not token:
        fail("No token found. Run: auth login")

    if token.get("access_token") and int(token.get("expires_at", 0)) > now_epoch():
        return token["access_token"]

    refresh_token = token.get("refresh_token")
    if not refresh_token:
        fail("Token expired and refresh_token missing. Run: auth login")

    refreshed = post_form(
        f"{auth_base(tenant)}/token",
        {
            "client_id": client_id,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "scope": " ".join(SCOPES),
        },
    )
    # Merge with old token so refresh_token is preserved if Microsoft doesn't return a new one
    merged = {**token, **refreshed}
    save_token(merged)
    return refreshed["access_token"]


def get_graph_token(interactive: bool = True) -> str:
    client_id, tenant = get_auth_settings(interactive=interactive)
    return ensure_access_token(client_id, tenant)


def graph_request(method: str, path: str, token: str, payload: dict | None = None, query: dict | None = None, expected: tuple[int, ...] = (200, 201, 202, 204)) -> dict:
    url = f"{GRAPH_BASE}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

    data = None
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.data = data
        req.add_header("Content-Type", "application/json")

    return http_json(req, expected=expected)


def graph_request_bytes(
    method: str,
    path: str,
    token: str,
    query: dict | None = None,
    expected: tuple[int, ...] = (200, 201, 202, 204),
) -> bytes:
    url = f"{GRAPH_BASE}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
            body = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        fail(f"HTTP {e.code} {e.reason}: {body}")
    except urllib.error.URLError as e:
        fail(f"Network error: {e.reason}")
    if status not in expected:
        fail(f"Unexpected HTTP status {status}: {body.decode('utf-8', errors='replace')}")
    return body


def cmd_auth_login(args: argparse.Namespace) -> None:
    client_id, tenant = get_auth_settings(interactive=True)

    device_code = post_form(
        f"{auth_base(tenant)}/devicecode",
        {
            "client_id": client_id,
            "scope": " ".join(SCOPES),
        },
    )

    print(device_code.get("message", "Open verification_uri and enter user_code."))
    expires_in = int(device_code.get("expires_in", 900))
    interval = int(device_code.get("interval", 5))
    deadline = now_epoch() + expires_in

    while now_epoch() < deadline:
        time.sleep(interval)
        form_data = urllib.parse.urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "client_id": client_id,
                "device_code": device_code["device_code"],
            }
        ).encode("utf-8")
        req = urllib.request.Request(f"{auth_base(tenant)}/token", data=form_data, method="POST")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req) as resp:
                token_resp = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            try:
                err = json.loads(body).get("error")
            except json.JSONDecodeError:
                err = None
            if err == "authorization_pending":
                continue
            if err == "slow_down":
                interval += 2
                continue
            fail(f"Device code token error: HTTP {e.code} {e.reason}: {body}")
        except urllib.error.URLError as e:
            fail(f"Network error during device code polling: {e.reason}")
        if token_resp.get("access_token"):
            save_token(token_resp)
            print(f"Login successful. Token saved to {TOKEN_CACHE}")
            return

    fail("Device code flow timeout. Retry auth login.")


def cmd_auth_status(args: argparse.Namespace) -> None:
    token = load_token()
    if not token:
        fail("No token cache found.")

    expires_at = int(token.get("expires_at", 0))
    human = dt.datetime.fromtimestamp(expires_at).isoformat() if expires_at else "unknown"
    valid = expires_at > now_epoch()
    print(json.dumps({
        "config_cache": str(CONFIG_CACHE),
        "token_cache": str(TOKEN_CACHE),
        "has_access_token": bool(token.get("access_token")),
        "has_refresh_token": bool(token.get("refresh_token")),
        "expires_at": human,
        "is_valid": valid,
    }, indent=2))


def cmd_calendar_list(args: argparse.Namespace) -> None:
    token = get_graph_token()
    start = args.start or dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    end = args.end or (dt.datetime.utcnow() + dt.timedelta(days=30)).replace(microsecond=0).isoformat() + "Z"
    data = graph_request(
        "GET",
        "/me/calendarView",
        token,
        query={"startDateTime": start, "endDateTime": end, "$top": args.top},
    )
    print(json.dumps(data, indent=2))


def cmd_calendar_create(args: argparse.Namespace) -> None:
    token = get_graph_token()
    payload = {
        "subject": args.subject,
        "start": {"dateTime": args.start, "timeZone": args.timezone},
        "end": {"dateTime": args.end, "timeZone": args.timezone},
    }
    if args.body:
        payload["body"] = {"contentType": "Text", "content": args.body}
    if args.location:
        payload["location"] = {"displayName": args.location}

    data = graph_request("POST", "/me/events", token, payload=payload, expected=(201,))
    print(json.dumps(data, indent=2))


def cmd_calendar_update(args: argparse.Namespace) -> None:
    token = get_graph_token()
    payload = {}
    if args.subject:
        payload["subject"] = args.subject
    if args.start:
        payload["start"] = {"dateTime": args.start, "timeZone": args.timezone}
    if args.end:
        payload["end"] = {"dateTime": args.end, "timeZone": args.timezone}
    if args.body:
        payload["body"] = {"contentType": "Text", "content": args.body}
    if args.location:
        payload["location"] = {"displayName": args.location}

    if not payload:
        fail("Provide at least one field to update.")

    graph_request("PATCH", f"/me/events/{args.event_id}", token, payload=payload, expected=(200, 202, 204))
    print(json.dumps({"updated": args.event_id}, indent=2))


def cmd_calendar_delete(args: argparse.Namespace) -> None:
    token = get_graph_token()
    graph_request("DELETE", f"/me/events/{args.event_id}", token, expected=(204,))
    print(json.dumps({"deleted": args.event_id}, indent=2))


def cmd_mail_search(args: argparse.Namespace) -> None:
    token = get_graph_token()
    q = {
        "$search": f'"{args.query}"',
        "$top": args.top,
        "$select": "id,subject,from,receivedDateTime,categories",
    }
    data = graph_request("GET", "/me/messages", token, query=q)
    print(json.dumps(data, indent=2))


def get_archive_folder_id(token: str) -> str:
    data = graph_request("GET", "/me/mailFolders/archive", token)
    folder_id = data.get("id")
    if not folder_id:
        fail("Archive folder not found.")
    return folder_id


def cmd_mail_archive(args: argparse.Namespace) -> None:
    token = get_graph_token()
    archive_id = get_archive_folder_id(token)
    data = graph_request(
        "POST",
        f"/me/messages/{args.message_id}/move",
        token,
        payload={"destinationId": archive_id},
        expected=(201, 200),
    )
    print(json.dumps(data, indent=2))


def cmd_mail_add_category(args: argparse.Namespace) -> None:
    token = get_graph_token()
    current = graph_request("GET", f"/me/messages/{args.message_id}", token, query={"$select": "categories"})
    categories = list(current.get("categories", []))
    if args.category not in categories:
        categories.append(args.category)
    data = graph_request(
        "PATCH",
        f"/me/messages/{args.message_id}",
        token,
        payload={"categories": categories},
        expected=(200, 202),
    )
    print(json.dumps({"message_id": args.message_id, "categories": categories, "response": data}, indent=2))


def cmd_mail_list_category(args: argparse.Namespace) -> None:
    token = get_graph_token()
    escaped_category = args.category.replace("'", "''")
    filter_expr = f"categories/any(c:c eq '{escaped_category}')"
    data = graph_request(
        "GET",
        "/me/messages",
        token,
        query={
            "$filter": filter_expr,
            "$top": args.top,
            "$select": "id,subject,from,receivedDateTime,categories",
        },
    )
    print(json.dumps(data, indent=2))


def cmd_mail_draft(args: argparse.Namespace) -> None:
    token = get_graph_token()
    payload = {
        "subject": args.subject,
        "body": {"contentType": "Text", "content": args.body},
        "toRecipients": [{"emailAddress": {"address": args.to}}],
    }
    data = graph_request("POST", "/me/messages", token, payload=payload, expected=(201,))
    print(json.dumps(data, indent=2))


def sanitize_filename(name: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in name).strip()
    return safe or "attachment.bin"


def unique_path(path: pathlib.Path) -> pathlib.Path:
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    i = 1
    while True:
        candidate = path.with_name(f"{stem}_{i}{suffix}")
        if not candidate.exists():
            return candidate
        i += 1


def normalize_cid(value: str | None) -> str:
    if not value:
        return ""
    cid = value.strip()
    if cid.lower().startswith("cid:"):
        cid = cid[4:]
    cid = cid.strip("<>").strip()
    return cid.lower()


def download_message_attachments(token: str, message_id: str, output_dir: pathlib.Path) -> list[dict]:
    listed = graph_request(
        "GET",
        f"/me/messages/{message_id}/attachments",
        token,
        query={"$top": 999, "$select": "id,name,contentType,size,isInline,contentId,@odata.type"},
    )
    items = listed.get("value", [])
    results: list[dict] = []

    for item in items:
        if item.get("@odata.type") != "#microsoft.graph.fileAttachment":
            continue
        attachment_id = item.get("id")
        if not attachment_id:
            continue
        detail = graph_request(
            "GET",
            f"/me/messages/{message_id}/attachments/{attachment_id}",
            token,
        )
        content_b64 = detail.get("contentBytes")
        if not content_b64:
            continue
        content = base64.b64decode(content_b64.encode("utf-8"))
        filename = sanitize_filename(detail.get("name") or f"attachment_{attachment_id}.bin")
        path = unique_path(output_dir / filename)
        path.write_bytes(content)
        results.append(
            {
                "id": attachment_id,
                "name": path.name,
                "local_path": str(path),
                "content_type": detail.get("contentType"),
                "size": detail.get("size", len(content)),
                "is_inline": bool(detail.get("isInline")),
                "content_id": detail.get("contentId"),
            }
        )
    return results


def trim_signature_from_wiki(text: str) -> str:
    lines = text.split("\n")
    signature_markers = [
        re.compile(r"^\s*--+\s*$", re.IGNORECASE),
        re.compile(r"^\s*bien cordialement[\s,!.:;]*$", re.IGNORECASE),
        re.compile(r"^\s*cordialement[\s,!.:;]*$", re.IGNORECASE),
        re.compile(r"^\s*best regards[\s,!.:;]*$", re.IGNORECASE),
        re.compile(r"^\s*kind regards[\s,!.:;]*$", re.IGNORECASE),
        re.compile(r"^\s*sent from my (iphone|android).*$", re.IGNORECASE),
    ]
    for idx, line in enumerate(lines):
        if any(rx.match(line) for rx in signature_markers):
            lines = lines[:idx]
            break
    return "\n".join(lines).strip()


def html_to_jira_wiki(html_content: str, cid_to_filename: dict[str, str], strip_signature: bool = True) -> str:
    text = html_content or ""
    text = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", "", text)
    if strip_signature:
        text = re.sub(
            r"""(?is)<(div|table|span|p)\b[^>]*(?:id|class)\s*=\s*("|\')[^"\']*signature[^"\']*\2[^>]*>.*?</\1>""",
            "",
            text,
        )
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)<li\b[^>]*>", "\n* ", text)
    text = re.sub(r"(?i)</(p|div|li|ul|ol|tr|table|blockquote|h[1-6])>", "\n", text)

    def repl_img(match: re.Match) -> str:
        tag = match.group(0)
        src_match = re.search(r"""(?i)\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))""", tag)
        src = ""
        if src_match:
            src = src_match.group(2) or src_match.group(3) or src_match.group(4) or ""
        cid = normalize_cid(src)
        if cid and cid in cid_to_filename:
            return f"\n!{cid_to_filename[cid]}!\n"
        if src:
            return f"\n[image: {src}]\n"
        return "\n"

    text = re.sub(r"(?is)<img\b[^>]*>", repl_img, text)
    text = re.sub(r"(?is)<[^>]+>", "", text)
    text = html_lib.unescape(text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [line.rstrip() for line in text.split("\n")]
    out = "\n".join(lines).strip()
    if strip_signature:
        out = trim_signature_from_wiki(out)
    return out


def expand_zip_attachments(attachments: list[dict], output_dir: pathlib.Path) -> list[dict]:
    expanded: list[dict] = []
    for attachment in attachments:
        local_path_raw = attachment.get("local_path")
        if not isinstance(local_path_raw, str) or not local_path_raw.strip():
            expanded.append(attachment)
            continue
        local_path = pathlib.Path(local_path_raw)
        is_zip = str(attachment.get("content_type") or "").lower() in {"application/zip", "application/x-zip-compressed"}
        if local_path.suffix.lower() == ".zip":
            is_zip = True
        if not is_zip:
            expanded.append(attachment)
            continue

        extracted: list[dict] = []
        try:
            with zipfile.ZipFile(local_path, "r") as zf:
                for member in zf.infolist():
                    if member.is_dir():
                        continue
                    member_name = pathlib.Path(member.filename).name
                    if not member_name:
                        continue
                    safe_name = sanitize_filename(member_name)
                    dest = unique_path(output_dir / safe_name)
                    with zf.open(member, "r") as src, dest.open("wb") as dst:
                        dst.write(src.read())
                    extracted.append(
                        {
                            "id": f"{attachment.get('id')}::{member.filename}",
                            "name": dest.name,
                            "local_path": str(dest),
                            "content_type": None,
                            "size": member.file_size,
                            "is_inline": False,
                            "content_id": None,
                            "extracted_from_zip": attachment.get("name"),
                        }
                    )
        except zipfile.BadZipFile:
            extracted = []

        if extracted:
            expanded.extend(extracted)
        else:
            expanded.append(attachment)
    return expanded


def cmd_mail_jira_package(args: argparse.Namespace) -> None:
    token = get_graph_token()
    output_dir = pathlib.Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    message = graph_request(
        "GET",
        f"/me/messages/{args.message_id}",
        token,
        query={"$select": "id,subject,from,receivedDateTime,body,internetMessageId,conversationId,hasAttachments"},
    )

    attachments = download_message_attachments(token, args.message_id, output_dir)
    attachments = expand_zip_attachments(attachments, output_dir)
    cid_to_filename = {
        normalize_cid(a.get("content_id")): a["name"]
        for a in attachments
        if normalize_cid(a.get("content_id"))
    }

    body = message.get("body", {}) or {}
    html_content = body.get("content", "") if isinstance(body, dict) else ""
    wiki_body = html_to_jira_wiki(html_content, cid_to_filename, strip_signature=True)

    inline_used = set(re.findall(r"!([^!\n]+)!", wiki_body))
    filtered_attachments: list[dict] = []
    for a in attachments:
        if a.get("is_inline"):
            name = str(a.get("name") or "")
            if name and name in inline_used:
                filtered_attachments.append(a)
            continue
        filtered_attachments.append(a)

    sender = (((message.get("from") or {}).get("emailAddress") or {}).get("name") or "").strip()
    if sender:
        wiki_body = f"{sender} :\n\n{wiki_body}".strip()

    package = {
        "message": {
            "id": message.get("id"),
            "subject": message.get("subject"),
            "receivedDateTime": message.get("receivedDateTime"),
            "internetMessageId": message.get("internetMessageId"),
            "conversationId": message.get("conversationId"),
            "from": (message.get("from") or {}).get("emailAddress", {}),
        },
        "jira_body_wiki": wiki_body,
        "attachments": filtered_attachments,
    }

    package_name = sanitize_filename(f"jira_package_{args.message_id}.json")
    package_path = output_dir / package_name
    package_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
    print(json.dumps({"package_path": str(package_path), "attachments_count": len(filtered_attachments), "preview": package}, indent=2))


def cmd_mail_thread(args: argparse.Namespace) -> None:
    token = get_graph_token()
    escaped_conv = args.conversation_id.replace("'", "''")
    filter_expr = f"conversationId eq '{escaped_conv}'"
    data = graph_request(
        "GET",
        "/me/messages",
        token,
        query={
            "$filter": filter_expr,
            "$orderby": "receivedDateTime asc",
            "$top": args.top,
            "$select": "id,conversationId,internetMessageId,subject,from,receivedDateTime,body,hasAttachments",
        },
    )
    print(json.dumps(data, indent=2))


def cmd_sharepoint_list_sites(args: argparse.Namespace) -> None:
    token = get_graph_token()
    data = graph_request("GET", "/sites", token, query={"search": args.query})
    print(json.dumps(data, indent=2))


def cmd_sharepoint_list_drives(args: argparse.Namespace) -> None:
    token = get_graph_token()
    data = graph_request("GET", f"/sites/{args.site_id}/drives", token)
    print(json.dumps(data, indent=2))


def cmd_sharepoint_create_folder(args: argparse.Namespace) -> None:
    token = get_graph_token()
    parent_id = args.parent_item_id or "root"
    payload = {
        "name": args.name,
        "folder": {},
        "@microsoft.graph.conflictBehavior": args.conflict,
    }
    data = graph_request(
        "POST",
        f"/sites/{args.site_id}/drives/{args.drive_id}/items/{parent_id}/children",
        token,
        payload=payload,
        expected=(201, 200),
    )
    print(json.dumps(data, indent=2))


def cmd_sharepoint_upload_file(args: argparse.Namespace) -> None:
    token = get_graph_token()
    local = pathlib.Path(args.local_path)
    if not local.exists() or not local.is_file():
        fail(f"File not found: {local}")

    parent_id = args.parent_item_id or "root"
    encoded_name = urllib.parse.quote(args.remote_name or local.name)
    path = f"/sites/{args.site_id}/drives/{args.drive_id}/items/{parent_id}:/{encoded_name}:/content"
    url = f"{GRAPH_BASE}{path}"

    with local.open("rb") as f:
        data = f.read()

    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/octet-stream")
    req.add_header("Accept", "application/json")
    result = http_json(req, expected=(200, 201))
    print(json.dumps(result, indent=2))


def cmd_sharepoint_move_item(args: argparse.Namespace) -> None:
    token = get_graph_token()
    payload = {"parentReference": {"id": args.new_parent_id}}
    if args.new_name:
        payload["name"] = args.new_name
    data = graph_request(
        "PATCH",
        f"/sites/{args.site_id}/drives/{args.drive_id}/items/{args.item_id}",
        token,
        payload=payload,
        expected=(200, 201),
    )
    print(json.dumps(data, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Microsoft 365 CLI via Microsoft Graph")
    sub = parser.add_subparsers(dest="domain", required=True)

    auth = sub.add_parser("auth", help="Authentication commands")
    auth_sub = auth.add_subparsers(dest="action", required=True)
    auth_login = auth_sub.add_parser("login", help="Run device code login")
    auth_login.set_defaults(func=cmd_auth_login)
    auth_status = auth_sub.add_parser("status", help="Show cached token status")
    auth_status.set_defaults(func=cmd_auth_status)

    cal = sub.add_parser("calendar", help="Calendar operations")
    cal_sub = cal.add_subparsers(dest="action", required=True)

    cal_list = cal_sub.add_parser("list", help="List events")
    cal_list.add_argument("--start", help="Start datetime ISO8601")
    cal_list.add_argument("--end", help="End datetime ISO8601")
    cal_list.add_argument("--top", type=int, default=20)
    cal_list.set_defaults(func=cmd_calendar_list)

    cal_create = cal_sub.add_parser("create", help="Create event")
    cal_create.add_argument("--subject", required=True)
    cal_create.add_argument("--start", required=True, help="ISO8601 date-time")
    cal_create.add_argument("--end", required=True, help="ISO8601 date-time")
    cal_create.add_argument("--timezone", default="UTC")
    cal_create.add_argument("--body")
    cal_create.add_argument("--location")
    cal_create.set_defaults(func=cmd_calendar_create)

    cal_update = cal_sub.add_parser("update", help="Update event")
    cal_update.add_argument("--event-id", required=True)
    cal_update.add_argument("--subject")
    cal_update.add_argument("--start", help="ISO8601 date-time")
    cal_update.add_argument("--end", help="ISO8601 date-time")
    cal_update.add_argument("--timezone", default="UTC")
    cal_update.add_argument("--body")
    cal_update.add_argument("--location")
    cal_update.set_defaults(func=cmd_calendar_update)

    cal_delete = cal_sub.add_parser("delete", help="Delete event")
    cal_delete.add_argument("--event-id", required=True)
    cal_delete.set_defaults(func=cmd_calendar_delete)

    mail = sub.add_parser("mail", help="Outlook mail operations")
    mail_sub = mail.add_subparsers(dest="action", required=True)

    mail_search = mail_sub.add_parser("search", help="Search messages")
    mail_search.add_argument("--query", required=True)
    mail_search.add_argument("--top", type=int, default=25)
    mail_search.set_defaults(func=cmd_mail_search)

    mail_archive = mail_sub.add_parser("archive", help="Move message to Archive")
    mail_archive.add_argument("--message-id", required=True)
    mail_archive.set_defaults(func=cmd_mail_archive)

    mail_cat = mail_sub.add_parser("add-category", help="Add category to message")
    mail_cat.add_argument("--message-id", required=True)
    mail_cat.add_argument("--category", required=True)
    mail_cat.set_defaults(func=cmd_mail_add_category)

    mail_lc = mail_sub.add_parser("list-category", help="List messages by category")
    mail_lc.add_argument("--category", required=True)
    mail_lc.add_argument("--top", type=int, default=25)
    mail_lc.set_defaults(func=cmd_mail_list_category)

    mail_draft = mail_sub.add_parser("draft", help="Create draft message")
    mail_draft.add_argument("--to", required=True)
    mail_draft.add_argument("--subject", required=True)
    mail_draft.add_argument("--body", required=True)
    mail_draft.set_defaults(func=cmd_mail_draft)

    mail_jira_pkg = mail_sub.add_parser("jira-package", help="Export one email to a Jira-ready package (wiki body + files)")
    mail_jira_pkg.add_argument("--message-id", required=True)
    mail_jira_pkg.add_argument("--output-dir", required=True)
    mail_jira_pkg.set_defaults(func=cmd_mail_jira_package)

    mail_thread = mail_sub.add_parser("thread", help="List messages for one Outlook conversation thread")
    mail_thread.add_argument("--conversation-id", required=True)
    mail_thread.add_argument("--top", type=int, default=200)
    mail_thread.set_defaults(func=cmd_mail_thread)

    sp = sub.add_parser("sharepoint", help="SharePoint and OneDrive operations")
    sp_sub = sp.add_subparsers(dest="action", required=True)

    sp_sites = sp_sub.add_parser("list-sites", help="Search sites")
    sp_sites.add_argument("--query", required=True)
    sp_sites.set_defaults(func=cmd_sharepoint_list_sites)

    sp_drives = sp_sub.add_parser("list-drives", help="List site drives")
    sp_drives.add_argument("--site-id", required=True)
    sp_drives.set_defaults(func=cmd_sharepoint_list_drives)

    sp_cf = sp_sub.add_parser("create-folder", help="Create folder")
    sp_cf.add_argument("--site-id", required=True)
    sp_cf.add_argument("--drive-id", required=True)
    sp_cf.add_argument("--name", required=True)
    sp_cf.add_argument("--parent-item-id")
    sp_cf.add_argument("--conflict", default="rename", choices=["rename", "replace", "fail"])
    sp_cf.set_defaults(func=cmd_sharepoint_create_folder)

    sp_up = sp_sub.add_parser("upload-file", help="Upload local file")
    sp_up.add_argument("--site-id", required=True)
    sp_up.add_argument("--drive-id", required=True)
    sp_up.add_argument("--local-path", required=True)
    sp_up.add_argument("--remote-name")
    sp_up.add_argument("--parent-item-id")
    sp_up.set_defaults(func=cmd_sharepoint_upload_file)

    sp_mv = sp_sub.add_parser("move-item", help="Move folder/file to another parent")
    sp_mv.add_argument("--site-id", required=True)
    sp_mv.add_argument("--drive-id", required=True)
    sp_mv.add_argument("--item-id", required=True)
    sp_mv.add_argument("--new-parent-id", required=True)
    sp_mv.add_argument("--new-name")
    sp_mv.set_defaults(func=cmd_sharepoint_move_item)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
