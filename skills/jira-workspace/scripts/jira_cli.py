#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def default_persist_dir() -> pathlib.Path:
    raw = os.environ.get("JIRA_PERSIST_DIR", "./.codex/persistant/token")
    return pathlib.Path(raw).expanduser()


PERSIST_DIR = default_persist_dir()
CONFIG_CACHE = pathlib.Path(os.environ.get("JIRA_CONFIG_CACHE", str(PERSIST_DIR / "jira_config.json"))).expanduser()


def fail(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def prompt_value(label: str, secret: bool = False, default: str | None = None) -> str:
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


def normalize_base_url(url: str) -> str:
    url = url.strip()
    if not url:
        return url
    if not url.startswith("http://") and not url.startswith("https://"):
        url = f"https://{url}"
    return url.rstrip("/")


def load_config() -> dict:
    if not CONFIG_CACHE.exists():
        return {}
    with CONFIG_CACHE.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict) -> None:
    CONFIG_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with CONFIG_CACHE.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


def get_auth_settings(interactive: bool = True) -> tuple[str, str, str]:
    cfg = load_config()
    base_url = os.environ.get("JIRA_BASE_URL") or cfg.get("base_url", "")
    email = os.environ.get("JIRA_EMAIL") or cfg.get("email", "")
    api_token = os.environ.get("JIRA_API_TOKEN") or cfg.get("api_token", "")
    updated = False

    if not base_url:
        if not interactive:
            fail("Missing Jira base URL.")
        base_url = prompt_value("Jira base URL (ex: https://tenant.atlassian.net)")
        updated = True

    if not email:
        if not interactive:
            fail("Missing Jira email.")
        email = prompt_value("Jira account email")
        updated = True

    if not api_token:
        if not interactive:
            fail("Missing Jira API token.")
        api_token = prompt_value("Jira API token")
        updated = True

    base_url = normalize_base_url(base_url)

    if updated:
        cfg["base_url"] = base_url
        cfg["email"] = email
        cfg["api_token"] = api_token
        save_config(cfg)
        print(f"Saved Jira config to {CONFIG_CACHE}")

    return base_url, email, api_token


def build_auth_header(email: str, api_token: str) -> str:
    raw = f"{email}:{api_token}".encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


def to_adf(text: str) -> dict:
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text or ""}],
            }
        ],
    }


def adf_to_text(node: object) -> str:
    """Flatten an Atlassian Document Format node (or plain string) to readable text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(child) for child in node)
    if isinstance(node, dict):
        ntype = node.get("type")
        if ntype == "text":
            return str(node.get("text", ""))
        if ntype == "hardBreak":
            return "\n"
        inner = adf_to_text(node.get("content"))
        if ntype in ("paragraph", "heading", "blockquote", "listItem", "codeBlock", "rule", "panel"):
            return inner + "\n"
        return inner
    return ""


def jira_request(method: str, path: str, payload: dict | None = None, expected: tuple[int, ...] = (200, 201, 204)) -> dict:
    base_url, email, api_token = get_auth_settings(interactive=True)
    url = f"{base_url}{path}"

    data = None
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", build_auth_header(email, api_token))
    req.add_header("Accept", "application/json")

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.data = data
        req.add_header("Content-Type", "application/json")

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


def jira_request_raw(
    method: str,
    path: str,
    data: bytes | None = None,
    expected: tuple[int, ...] = (200, 201, 204),
    extra_headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    base_url, email, api_token = get_auth_settings(interactive=True)
    url = f"{base_url}{path}"
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header("Authorization", build_auth_header(email, api_token))
    req.add_header("Accept", "application/json")
    for key, value in (extra_headers or {}).items():
        req.add_header(key, value)

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
        try:
            text = body.decode("utf-8", errors="replace")
        except Exception:
            text = "<binary body>"
        fail(f"Unexpected HTTP status {status}: {text}")

    return status, body


def cmd_auth_setup(args: argparse.Namespace) -> None:
    cfg = load_config()
    base_default = normalize_base_url(cfg.get("base_url", ""))
    email_default = cfg.get("email", "")

    base_url = normalize_base_url(prompt_value("Jira base URL", default=base_default if base_default else None))
    email = prompt_value("Jira account email", default=email_default if email_default else None)
    api_token = prompt_value("Jira API token")

    cfg["base_url"] = base_url
    cfg["email"] = email
    cfg["api_token"] = api_token
    save_config(cfg)
    print(json.dumps({"saved": str(CONFIG_CACHE), "base_url": base_url, "email": email}, indent=2))


def cmd_auth_status(args: argparse.Namespace) -> None:
    cfg = load_config()
    if not cfg:
        fail("No Jira config found. Run: auth setup")

    base_url = normalize_base_url(os.environ.get("JIRA_BASE_URL") or cfg.get("base_url", ""))
    email = os.environ.get("JIRA_EMAIL") or cfg.get("email", "")
    api_token = os.environ.get("JIRA_API_TOKEN") or cfg.get("api_token", "")

    me = jira_request("GET", "/rest/api/3/myself", expected=(200,))
    print(
        json.dumps(
            {
                "config_cache": str(CONFIG_CACHE),
                "base_url": base_url,
                "email": email,
                "has_api_token": bool(api_token),
                "accountId": me.get("accountId"),
                "displayName": me.get("displayName"),
                "active": me.get("active"),
            },
            indent=2,
        )
    )


def cmd_issue_create(args: argparse.Namespace) -> None:
    payload = {
        "fields": {
            "project": {"key": args.project_key},
            "summary": args.summary,
            "issuetype": {"name": args.issue_type},
            "description": to_adf(args.description or ""),
        }
    }
    data = jira_request("POST", "/rest/api/3/issue", payload=payload, expected=(201,))
    print(json.dumps(data, indent=2))


def cmd_issue_edit(args: argparse.Namespace) -> None:
    fields = {}
    if args.summary:
        fields["summary"] = args.summary
    if args.description is not None:
        fields["description"] = to_adf(args.description)
    if args.issue_type:
        fields["issuetype"] = {"name": args.issue_type}

    if not fields:
        fail("Provide at least one field to edit.")

    jira_request("PUT", f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}", payload={"fields": fields}, expected=(204,))
    print(json.dumps({"updated": args.issue_key}, indent=2))


def cmd_issue_delete(args: argparse.Namespace) -> None:
    jira_request("DELETE", f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}", expected=(204,))
    print(json.dumps({"deleted": args.issue_key}, indent=2))


def cmd_project_create(args: argparse.Namespace) -> None:
    payload = {
        "key": args.key,
        "name": args.name,
        "projectTypeKey": args.project_type,
        "projectTemplateKey": args.project_template,
    }
    data = jira_request("POST", "/rest/api/3/project", payload=payload, expected=(201,))
    print(json.dumps(data, indent=2))


def cmd_comment_add(args: argparse.Namespace) -> None:
    if args.format == "wiki":
        payload = {"body": args.body}
        data = jira_request(
            "POST",
            f"/rest/api/2/issue/{urllib.parse.quote(args.issue_key)}/comment",
            payload=payload,
            expected=(201,),
        )
    elif args.format == "adf":
        payload = {"body": json.loads(args.body)}
        data = jira_request(
            "POST",
            f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}/comment",
            payload=payload,
            expected=(201,),
        )
    else:
        payload = {"body": to_adf(args.body)}
        data = jira_request(
            "POST",
            f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}/comment",
            payload=payload,
            expected=(201,),
        )
    print(json.dumps(data, indent=2))


def sanitize_filename(name: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in name).strip()
    return safe or "attachment.bin"


def build_multipart_form(files: list[tuple[str, bytes]]) -> tuple[str, bytes]:
    boundary = f"----CodexJiraBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for filename, content in files:
        safe_name = sanitize_filename(filename)
        ctype = mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
        parts.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="file"; filename="{safe_name}"\r\n'.encode("utf-8"),
                f"Content-Type: {ctype}\r\n\r\n".encode("utf-8"),
                content,
                b"\r\n",
            ]
        )
    parts.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(parts)


def upload_attachments(issue_key: str, file_paths: list[pathlib.Path]) -> list[dict]:
    files_payload: list[tuple[str, bytes]] = []
    for p in file_paths:
        if not p.exists() or not p.is_file():
            fail(f"Attachment file not found: {p}")
        files_payload.append((p.name, p.read_bytes()))

    boundary, data = build_multipart_form(files_payload)
    _, body = jira_request_raw(
        "POST",
        f"/rest/api/3/issue/{urllib.parse.quote(issue_key)}/attachments",
        data=data,
        expected=(200, 201),
        extra_headers={
            "X-Atlassian-Token": "no-check",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        parsed = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        fail("Unable to parse Jira attachment response.")
    return parsed if isinstance(parsed, list) else [parsed]


def fetch_all_comments(issue_key: str, api_version: int = 3) -> list[dict]:
    comments: list[dict] = []
    start_at = 0
    max_results = 100
    while True:
        data = jira_request(
            "GET",
            f"/rest/api/{api_version}/issue/{urllib.parse.quote(issue_key)}/comment?startAt={start_at}&maxResults={max_results}",
            expected=(200,),
        )
        page_items = data.get("comments", [])
        comments.extend(page_items)
        total = int(data.get("total", len(comments)))
        returned = int(data.get("maxResults", len(page_items))) if page_items else len(page_items)
        start_at += returned
        if start_at >= total or not page_items:
            break
    return comments


def normalize_wiki_text(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip()


def canonical_comment_body(body: object) -> str:
    if isinstance(body, str):
        return f"wiki:{normalize_wiki_text(body)}"
    if isinstance(body, dict):
        try:
            return "adf:" + json.dumps(body, sort_keys=True, separators=(",", ":"))
        except Exception:
            return ""
    return ""


def get_current_account_id() -> str:
    me = jira_request("GET", "/rest/api/3/myself", expected=(200,))
    return str(me.get("accountId") or "")


def cmd_attachment_add(args: argparse.Namespace) -> None:
    paths = [pathlib.Path(p).expanduser() for p in args.file]
    result = upload_attachments(args.issue_key, paths)
    print(json.dumps({"issue_key": args.issue_key, "uploaded": result}, indent=2))


def cmd_comment_add_from_package(args: argparse.Namespace) -> None:
    package_path = pathlib.Path(args.package_json).expanduser()
    if not package_path.exists() or not package_path.is_file():
        fail(f"Package file not found: {package_path}")

    package = json.loads(package_path.read_text(encoding="utf-8"))
    wiki_body = package.get("jira_body_wiki")
    if not isinstance(wiki_body, str) or not wiki_body.strip():
        fail("Invalid package: 'jira_body_wiki' is required.")

    attachments = package.get("attachments", [])
    file_paths: list[pathlib.Path] = []
    if isinstance(attachments, list):
        for item in attachments:
            if not isinstance(item, dict):
                continue
            local_path = item.get("local_path")
            if isinstance(local_path, str) and local_path.strip():
                p = pathlib.Path(local_path)
                if not p.is_absolute():
                    p = (package_path.parent / p).resolve()
                file_paths.append(p)

    # Idempotence guard: if an identical wiki comment already exists, do not post it again.
    existing = fetch_all_comments(args.issue_key, api_version=2)
    target = canonical_comment_body(wiki_body)
    already_exists = any(canonical_comment_body(c.get("body")) == target for c in existing)
    if already_exists:
        print(
            json.dumps(
                {
                    "issue_key": args.issue_key,
                    "skipped": True,
                    "reason": "Identical comment already exists on ticket.",
                },
                indent=2,
            )
        )
        return

    uploaded = upload_attachments(args.issue_key, file_paths) if file_paths else []
    comment = jira_request(
        "POST",
        f"/rest/api/2/issue/{urllib.parse.quote(args.issue_key)}/comment",
        payload={"body": wiki_body},
        expected=(201,),
    )
    print(
        json.dumps(
            {
                "issue_key": args.issue_key,
                "uploaded_count": len(uploaded),
                "uploaded": uploaded,
                "comment_id": comment.get("id"),
            },
            indent=2,
        )
    )


def cmd_comment_consolidate_duplicates(args: argparse.Namespace) -> None:
    comments = fetch_all_comments(args.issue_key, api_version=3)
    current_account_id = get_current_account_id() if not args.all_authors else ""

    buckets: dict[tuple[str, str], list[dict]] = {}
    for c in comments:
        body_key = canonical_comment_body(c.get("body"))
        if not body_key:
            continue
        author_id = str(((c.get("author") or {}).get("accountId")) or "")
        if current_account_id and author_id != current_account_id:
            continue
        key = (author_id, body_key)
        buckets.setdefault(key, []).append(c)

    to_delete: list[dict] = []
    groups_report: list[dict] = []
    for (author_id, _body_key), group in buckets.items():
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda x: (str(x.get("created") or ""), str(x.get("id") or "")))
        keep = ordered[0]
        dupes = ordered[1:]
        to_delete.extend(dupes)
        groups_report.append(
            {
                "author_account_id": author_id,
                "kept_comment_id": keep.get("id"),
                "duplicate_comment_ids": [d.get("id") for d in dupes],
                "count": len(group),
            }
        )

    deleted_ids: list[str] = []
    if args.apply:
        for c in to_delete:
            cid = str(c.get("id"))
            jira_request(
                "DELETE",
                f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}/comment/{urllib.parse.quote(cid)}",
                expected=(204,),
            )
            deleted_ids.append(cid)

    print(
        json.dumps(
            {
                "issue_key": args.issue_key,
                "scope": "all_authors" if args.all_authors else "current_user_only",
                "duplicate_groups": groups_report,
                "duplicates_found": len(to_delete),
                "deleted_count": len(deleted_ids),
                "deleted_ids": deleted_ids,
                "dry_run": not args.apply,
            },
            indent=2,
        )
    )


def cmd_comment_list(args: argparse.Namespace) -> None:
    comments = fetch_all_comments(args.issue_key, api_version=args.api_version)
    if args.compact:
        comments = [
            {
                "id": c.get("id"),
                "created": c.get("created"),
                "updated": c.get("updated"),
                "author": (c.get("author") or {}).get("displayName"),
                "authorAccountId": (c.get("author") or {}).get("accountId"),
                "body": c.get("body"),
            }
            for c in comments
        ]
    print(json.dumps({"issue_key": args.issue_key, "count": len(comments), "comments": comments}, indent=2))


def cmd_comment_delete(args: argparse.Namespace) -> None:
    jira_request(
        "DELETE",
        f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}/comment/{urllib.parse.quote(args.comment_id)}",
        expected=(204,),
    )
    print(json.dumps({"issue_key": args.issue_key, "deleted_comment_id": args.comment_id}, indent=2))


def cmd_issue_get(args: argparse.Namespace) -> None:
    path = f"/rest/api/3/issue/{urllib.parse.quote(args.issue_key)}?fields={urllib.parse.quote(args.fields)}"
    data = jira_request("GET", path, expected=(200,))
    fields = data.get("fields") or {}
    status = fields.get("status") or {}
    resolution = fields.get("resolution") or {}
    result = {
        "key": data.get("key"),
        "summary": fields.get("summary"),
        "status": status.get("name"),
        "statusCategory": ((status.get("statusCategory") or {}).get("name")),
        "issuetype": (fields.get("issuetype") or {}).get("name"),
        "priority": (fields.get("priority") or {}).get("name"),
        "resolution": resolution.get("name") if resolution else None,
        "created": fields.get("created"),
        "updated": fields.get("updated"),
        "labels": fields.get("labels", []),
        "description": adf_to_text(fields.get("description")).strip(),
        "attachments": [
            {
                "filename": a.get("filename"),
                "mimeType": a.get("mimeType"),
                "size": a.get("size"),
            }
            for a in (fields.get("attachment") or [])
        ],
    }
    if args.raw:
        result["fields"] = fields
    print(json.dumps(result, indent=2, ensure_ascii=False))


def cmd_search(args: argparse.Namespace) -> None:
    collected: list[dict] = []
    next_token: str | None = None
    remaining = max(1, args.max_results)
    while remaining > 0:
        params = {
            "jql": args.jql,
            "maxResults": str(min(100, remaining)),
            "fields": args.fields,
        }
        if next_token:
            params["nextPageToken"] = next_token
        query = urllib.parse.urlencode(params)
        data = jira_request("GET", f"/rest/api/3/search/jql?{query}", expected=(200,))
        issues = data.get("issues", []) or []
        for issue in issues:
            fields = issue.get("fields") or {}
            row = {
                "key": issue.get("key"),
                "summary": fields.get("summary"),
                "status": (fields.get("status") or {}).get("name"),
                "statusCategory": (((fields.get("status") or {}).get("statusCategory") or {}).get("name")),
                "created": fields.get("created"),
                "updated": fields.get("updated"),
            }
            if args.with_description:
                row["description"] = adf_to_text(fields.get("description")).strip()[:1500]
            collected.append(row)
        remaining -= len(issues)
        next_token = data.get("nextPageToken")
        if data.get("isLast") or not next_token or not issues:
            break
    # Le endpoint /search/jql traite maxResults comme une borne indicative : on tronque pour respecter --max-results.
    collected = collected[: max(0, args.max_results)]
    print(json.dumps({"jql": args.jql, "count": len(collected), "issues": collected}, indent=2, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Jira CLI via Jira REST API")
    sub = parser.add_subparsers(dest="domain", required=True)

    auth = sub.add_parser("auth", help="Authentication commands")
    auth_sub = auth.add_subparsers(dest="action", required=True)
    auth_setup = auth_sub.add_parser("setup", help="Save Jira credentials and URL")
    auth_setup.set_defaults(func=cmd_auth_setup)
    auth_status = auth_sub.add_parser("status", help="Validate Jira auth and show current identity")
    auth_status.set_defaults(func=cmd_auth_status)

    issue = sub.add_parser("issue", help="Issue operations")
    issue_sub = issue.add_subparsers(dest="action", required=True)

    issue_create = issue_sub.add_parser("create", help="Create issue")
    issue_create.add_argument("--project-key", required=True)
    issue_create.add_argument("--summary", required=True)
    issue_create.add_argument("--description", default="")
    issue_create.add_argument("--issue-type", default="Task")
    issue_create.set_defaults(func=cmd_issue_create)

    issue_edit = issue_sub.add_parser("edit", help="Edit issue")
    issue_edit.add_argument("--issue-key", required=True)
    issue_edit.add_argument("--summary")
    issue_edit.add_argument("--description")
    issue_edit.add_argument("--issue-type")
    issue_edit.set_defaults(func=cmd_issue_edit)

    issue_delete = issue_sub.add_parser("delete", help="Delete issue")
    issue_delete.add_argument("--issue-key", required=True)
    issue_delete.set_defaults(func=cmd_issue_delete)

    issue_get = issue_sub.add_parser("get", help="Read one issue (compact, description ADF flattened)")
    issue_get.add_argument("--issue-key", required=True)
    issue_get.add_argument(
        "--fields",
        default="summary,status,issuetype,priority,resolution,created,updated,labels,description,attachment",
    )
    issue_get.add_argument("--raw", action="store_true", help="Also include the raw Jira fields object")
    issue_get.set_defaults(func=cmd_issue_get)

    project = sub.add_parser("project", help="Project operations")
    project_sub = project.add_subparsers(dest="action", required=True)

    project_create = project_sub.add_parser("create", help="Create project")
    project_create.add_argument("--key", required=True)
    project_create.add_argument("--name", required=True)
    project_create.add_argument("--project-type", default="software", choices=["software", "service_desk", "business"])
    project_create.add_argument("--project-template", default="com.pyxis.greenhopper.jira:gh-simplified-scrum-classic")
    project_create.set_defaults(func=cmd_project_create)

    comment = sub.add_parser("comment", help="Comment operations")
    comment_sub = comment.add_subparsers(dest="action", required=True)

    comment_add = comment_sub.add_parser("add", help="Add comment to issue")
    comment_add.add_argument("--issue-key", required=True)
    comment_add.add_argument("--body", required=True)
    comment_add.add_argument("--format", choices=["text", "wiki", "adf"], default="text")
    comment_add.set_defaults(func=cmd_comment_add)

    comment_from_pkg = comment_sub.add_parser("add-from-package", help="Upload attachments then add wiki comment from a package JSON")
    comment_from_pkg.add_argument("--issue-key", required=True)
    comment_from_pkg.add_argument("--package-json", required=True)
    comment_from_pkg.set_defaults(func=cmd_comment_add_from_package)

    comment_dedupe = comment_sub.add_parser("consolidate-duplicates", help="Find and optionally delete duplicate comments")
    comment_dedupe.add_argument("--issue-key", required=True)
    comment_dedupe.add_argument("--apply", action="store_true", help="Actually delete duplicates (default: dry-run)")
    comment_dedupe.add_argument("--all-authors", action="store_true", help="Include comments from all authors (default: only current user)")
    comment_dedupe.set_defaults(func=cmd_comment_consolidate_duplicates)

    comment_list = comment_sub.add_parser("list", help="List comments for an issue")
    comment_list.add_argument("--issue-key", required=True)
    comment_list.add_argument("--api-version", type=int, default=3, choices=[2, 3])
    comment_list.add_argument("--compact", action="store_true")
    comment_list.set_defaults(func=cmd_comment_list)

    comment_delete = comment_sub.add_parser("delete", help="Delete one comment by id")
    comment_delete.add_argument("--issue-key", required=True)
    comment_delete.add_argument("--comment-id", required=True)
    comment_delete.set_defaults(func=cmd_comment_delete)

    search = sub.add_parser("search", help="Search issues with JQL (read-only)")
    search.add_argument("--jql", required=True, help='JQL, e.g. project IN (SUPIOBEYA, SUPNG) AND text ~ "licence"')
    search.add_argument("--max-results", type=int, default=50, help="Max issues to return (paginated, default 50)")
    search.add_argument("--fields", default="summary,status,created,updated", help="Comma-separated fields")
    search.add_argument("--with-description", action="store_true", help="Include a truncated flattened description per issue")
    search.set_defaults(func=cmd_search)

    attachment = sub.add_parser("attachment", help="Attachment operations")
    attachment_sub = attachment.add_subparsers(dest="action", required=True)
    attachment_add = attachment_sub.add_parser("add", help="Upload one or more files to an issue")
    attachment_add.add_argument("--issue-key", required=True)
    attachment_add.add_argument("--file", action="append", required=True, help="Path to file (repeat --file for multiple)")
    attachment_add.set_defaults(func=cmd_attachment_add)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
