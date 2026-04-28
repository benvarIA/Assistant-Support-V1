#!/usr/bin/env python3
import argparse
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[3]
MS_CLI = ROOT / "skills" / "microsoft-365-workspace" / "scripts" / "ms_graph_cli.py"
JIRA_CLI = ROOT / "skills" / "jira-workspace" / "scripts" / "jira_cli.py"
THREAD_MAP = ROOT / ".codex" / "persistant" / "token" / "pandito_thread_jira_map.json"


def fail(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def run_json(cmd: list[str]) -> dict[str, Any]:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        fail(f"Command failed ({' '.join(cmd)}):\n{proc.stderr.strip() or proc.stdout.strip()}")
    out = proc.stdout.strip()
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        fail(f"Non-JSON output from command {' '.join(cmd)}:\n{out}")
    return {}


def load_ms_module() -> Any:
    spec = importlib.util.spec_from_file_location("ms_graph_cli_module", str(MS_CLI))
    if not spec or not spec.loader:
        fail("Unable to load ms_graph_cli.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_conversation_id(issue_key: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    if not THREAD_MAP.exists():
        fail("Missing conversation mapping file and no --conversation-id provided.")
    data = json.loads(THREAD_MAP.read_text(encoding="utf-8"))
    matches = [conv for conv, jira in data.items() if str(jira).upper() == issue_key.upper()]
    if not matches:
        fail(f"No conversationId mapped to {issue_key}. Provide --conversation-id.")
    if len(matches) > 1:
        fail(f"Multiple conversationIds mapped to {issue_key}. Provide --conversation-id explicitly.")
    return matches[0]


def normalize_text(text: str) -> str:
    t = text.replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def adf_to_text(node: Any) -> str:
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "".join(adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""
    ntype = node.get("type")
    if ntype == "text":
        return node.get("text", "")
    if ntype == "hardBreak":
        return "\n"
    if ntype in {"paragraph", "heading", "blockquote"}:
        return adf_to_text(node.get("content", [])) + "\n"
    if ntype in {"doc", "listItem"}:
        return adf_to_text(node.get("content", []))
    if ntype in {"bulletList", "orderedList"}:
        return "\n".join(adf_to_text(item).strip() for item in node.get("content", [])) + "\n"
    return adf_to_text(node.get("content", []))


def comment_body_to_text(body: Any) -> str:
    if isinstance(body, str):
        return body
    return adf_to_text(body)


def message_to_expected_comment(ms_mod: Any, msg: dict[str, Any]) -> str:
    from_name = (((msg.get("from") or {}).get("emailAddress") or {}).get("name") or "").strip()
    html_body = ((msg.get("body") or {}).get("content") or "").strip()
    wiki_body = ms_mod.html_to_jira_wiki(html_body, {}, strip_signature=True)
    if from_name:
        return f"{from_name} :\n\n{wiki_body}".strip()
    return wiki_body.strip()


def message_to_expected_comment_legacy(ms_mod: Any, msg: dict[str, Any]) -> str:
    from_name = (((msg.get("from") or {}).get("emailAddress") or {}).get("name") or "").strip()
    html_body = ((msg.get("body") or {}).get("content") or "").strip()
    wiki_body = ms_mod.html_to_jira_wiki(html_body, {}, strip_signature=False)
    if from_name:
        return f"{from_name} :\n\n{wiki_body}".strip()
    return wiki_body.strip()


def find_trace_cursor(comments: list[dict[str, Any]], expected_messages: list[dict[str, Any]]) -> tuple[int, dict[str, Any], dict[str, Any]]:
    expected_norm = [normalize_text(m["expected_comment"]) for m in expected_messages]
    expected_norm_legacy = [normalize_text(m.get("expected_comment_legacy", "")) for m in expected_messages]
    for c in reversed(comments):
        ctext = normalize_text(comment_body_to_text(c.get("body")))
        if not ctext:
            continue
        if ctext in expected_norm:
            idx = expected_norm.index(ctext)
            return idx, c, expected_messages[idx]
        if ctext in expected_norm_legacy:
            idx = expected_norm_legacy.index(ctext)
            return idx, c, expected_messages[idx]
    fail("Impossible de mapper le dernier commentaire Jira a un email du thread. Donne --conversation-id ou nettoie le dernier commentaire.")
    return -1, {}, {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Trace les emails suivants d'un thread vers les commentaires Jira, sans doublons.")
    parser.add_argument("--issue-key", required=True)
    parser.add_argument("--conversation-id")
    parser.add_argument("--work-dir", default="/tmp/jira-thread-trace")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    conversation_id = resolve_conversation_id(args.issue_key, args.conversation_id)
    ms_mod = load_ms_module()

    comments_resp = run_json(["python3", str(JIRA_CLI), "comment", "list", "--issue-key", args.issue_key, "--compact"])
    comments = comments_resp.get("comments", [])
    if not comments:
        fail(f"Aucun commentaire sur {args.issue_key}. Impossible de calculer 'email suivant'.")

    thread_resp = run_json(
        ["python3", str(MS_CLI), "mail", "thread", "--conversation-id", conversation_id, "--top", "500"]
    )
    messages = thread_resp.get("value", [])
    if not messages:
        fail("Aucun email trouve pour ce conversationId.")

    expected_messages = []
    for msg in messages:
        expected_messages.append(
            {
                "id": msg.get("id"),
                "internetMessageId": msg.get("internetMessageId"),
                "receivedDateTime": msg.get("receivedDateTime"),
                "subject": msg.get("subject"),
                "expected_comment": message_to_expected_comment(ms_mod, msg),
                "expected_comment_legacy": message_to_expected_comment_legacy(ms_mod, msg),
            }
        )

    cursor_idx, cursor_comment, cursor_mail = find_trace_cursor(comments, expected_messages)
    next_messages = expected_messages[cursor_idx + 1 :]

    if args.dry_run:
        print(
            json.dumps(
                {
                    "issue_key": args.issue_key,
                    "conversation_id": conversation_id,
                    "cursor": {
                        "jira_comment_id": cursor_comment.get("id"),
                        "mail_id": cursor_mail.get("id"),
                        "mail_received": cursor_mail.get("receivedDateTime"),
                    },
                    "to_trace_count": len(next_messages),
                    "to_trace_mail_ids": [m.get("id") for m in next_messages],
                    "dry_run": True,
                },
                indent=2,
            )
        )
        return

    work_dir = pathlib.Path(args.work_dir).expanduser().resolve() / args.issue_key
    work_dir.mkdir(parents=True, exist_ok=True)

    traced = []
    skipped = []
    for msg in next_messages:
        package = run_json(
            [
                "python3",
                str(MS_CLI),
                "mail",
                "jira-package",
                "--message-id",
                str(msg["id"]),
                "--output-dir",
                str(work_dir),
            ]
        )
        package_path = package.get("package_path")
        if not package_path:
            fail(f"jira-package failed for message {msg['id']}")
        post = run_json(
            [
                "python3",
                str(JIRA_CLI),
                "comment",
                "add-from-package",
                "--issue-key",
                args.issue_key,
                "--package-json",
                str(package_path),
            ]
        )
        if post.get("skipped"):
            skipped.append({"message_id": msg["id"], "reason": post.get("reason")})
        else:
            traced.append({"message_id": msg["id"], "comment_id": post.get("comment_id"), "uploaded_count": post.get("uploaded_count")})

    print(
        json.dumps(
            {
                "issue_key": args.issue_key,
                "conversation_id": conversation_id,
                "cursor_comment_id": cursor_comment.get("id"),
                "cursor_mail_id": cursor_mail.get("id"),
                "traced_count": len(traced),
                "skipped_count": len(skipped),
                "traced": traced,
                "skipped": skipped,
                "remaining": 0,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
