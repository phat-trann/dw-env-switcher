#!/bin/bash
set -o pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CONFIG_FILE="dw.json"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_CONFIG=""
SITE_ID=""
ACTION="all"
FORCE_INSTALL=0
FORCE_REINSTALL=0
COMPILE_TARGET=all
priority_branches=("staging-new" "v3.3.0" "release/v3.3.0" "master")
while [ "$#" -gt 0 ]; do
    [ "$#" -ge 2 ] || { printf "Missing option value\n"; exit 1; }
    case "$1" in
        --site-config|--manager-config) SITE_CONFIG="$2" ;;
        --site-id) SITE_ID="$2" ;;
        --root) ROOT_DIR="$2" ;;
        --action) ACTION="$2" ;;
        *) printf "Unknown option: %s\n" "$1"; exit 1 ;;
    esac
    shift 2
done
overall_status=0
GIT_JOBS="${GIT_JOBS:-8}"
REPO_JOBS="${REPO_JOBS:-4}"
SKIP_GIT="${SKIP_GIT:-0}"
SKIP_NPM="${SKIP_NPM:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
CHANGED_ONLY="${CHANGED_ONLY:-0}"
REINSTALL_DAYS="${REINSTALL_DAYS:-30}"
NODE_VERSION="${NODE_VERSION:-8.17.0}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/.dw-update-log.json}"

cd "$ROOT_DIR" || exit 1
ROOT_DIR="$(pwd -P)"

mark_fail() {
    overall_status=1
}

die() {
    printf "${RED}Error: %s${NC}\n" "$1"
    exit 1
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

is_positive_int() {
    case "$1" in
        ''|*[!0-9]*|0*) return 1 ;;
        *) return 0 ;;
    esac
}

validate_flag() {
    case "$2" in
        0|1) return 0 ;;
        *) die "$1 must be 0 or 1" ;;
    esac
}

wait_for_slot() {
    local max_jobs="$1"
    while [ "$(jobs -pr | wc -l | tr -d ' ')" -ge "$max_jobs" ]; do
        sleep 0.2
    done
}

wait_for_pids() {
    local failed=false
    local pid

    for pid in "$@"; do
        if ! wait "$pid"; then
            failed=true
        fi
    done

    [ "$failed" = false ]
}

# --- STEP 1: CONFIG ---
require_cmd python3
# Site mode reads only the selected Site/tool settings; never reads/writes dw.json.
if [ -n "$SITE_CONFIG" ]; then
    [ -f "$SITE_CONFIG" ] || die "Missing Site configuration"
    CONFIG_DATA=$(python3 - "$SITE_CONFIG" "$SITE_ID" <<'PYSITE'
import json, re, sys
with open(sys.argv[1]) as source:
    data = json.load(source)
if sys.argv[2]:
    matches = [site for site in data.get('sites', []) if site.get('id') == sys.argv[2]]
    if len(matches) != 1:
        sys.exit('Site ID must identify exactly one Site')
    site = matches[0]
    settings = dict(data.get('repoTools', {}))
    settings.update(site.get('repoTools', {}))
else:
    site, settings = data['site'], data['repoTools']
cartridges = site.get('cartridgesPath')
if not isinstance(cartridges, str) or not cartridges.strip(':') or any(not re.fullmatch(r'[A-Za-z0-9_.-]+', part) or part in ('.', '..') for part in cartridges.split(':') if part):
    sys.exit('Invalid cartridgesPath')
print('cartridges\t' + ':'.join(part for part in cartridges.split(':') if part))
def setting(name, default):
    return settings.get(name, default)
node = setting('nodeVersion', '8.17.0')
if not isinstance(node, str) or not re.fullmatch(r'v?[0-9]+(?:\.[0-9]+){0,2}', node):
    sys.exit('nodeVersion must be a numeric Node version')
print('node\t' + node)
for key, default in [('gitJobs', 8), ('repoJobs', 4), ('reinstallDays', 30)]:
    value = setting(key, default)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        sys.exit('Invalid ' + key)
    print(key + '\t' + str(value))
branches = setting('priorityBranches', ['staging-new', 'v3.3.0', 'release/v3.3.0', 'master'])
if not isinstance(branches, list) or not branches:
    sys.exit('priorityBranches must be a nonempty array')
for branch in branches:
    if not isinstance(branch, str) or not re.fullmatch(r'[A-Za-z0-9_./-]+', branch) or branch.startswith('-'):
        sys.exit('Invalid priority branch')
    print('branch\t' + branch)
skips = setting('skipRepos', {name: {'skipInstall': True, 'skipCompile': True} for name in (
    'lib_productlist', 'link_afterpay', 'plugin_facebooktracking', 'plugin_passwordlesslogin',
    'plugin_ordermonitoring', 'plugin_pinteresttracking', 'plugin_pushnotifications')})
if not isinstance(skips, dict) or any(not isinstance(policy, dict) or any(not isinstance(policy.get(key, False), bool) for key in ('skipInstall', 'skipCompile')) for policy in skips.values()):
    sys.exit('Invalid skipRepos')
print('skips\t' + json.dumps({name: {'skip_install': policy.get('skipInstall', False), 'skip_compile': policy.get('skipCompile', False)} for name, policy in skips.items()}))
PYSITE
    ) || die "Invalid Site repository configuration"
    priority_branches=()
    while IFS=$'\t' read -r key value; do
        case "$key" in
            cartridges) DW_CARTRIDGES_PATH="$value" ;;
            node) NODE_VERSION="$value" ;;
            gitJobs) GIT_JOBS="$value" ;;
            repoJobs) REPO_JOBS="$value" ;;
            reinstallDays) REINSTALL_DAYS="$value" ;;
            branch) priority_branches+=("$value") ;;
            skips) export DW_SKIP_REPOS_JSON="$value" ;;
        esac
    done <<< "$CONFIG_DATA"
else
    # Backward compatible command-line mode.
    [ -f "$CONFIG_FILE" ] || die "Missing $CONFIG_FILE"
    DW_CARTRIDGES_PATH=$(python3 - "$CONFIG_FILE" <<'PYCONFIG'
import json, sys
with open(sys.argv[1]) as source:
    value = json.load(source).get('cartridgesPath')
if not isinstance(value, str) or not value.strip():
    sys.exit('cartridgesPath must be a non-empty string')
print(value)
PYCONFIG
    ) || die "Invalid $CONFIG_FILE config"
fi
case "$ACTION" in
    all) ;;
    changed) CHANGED_ONLY=1 ;;
    git) SKIP_NPM=1; SKIP_BUILD=1 ;;
    install) SKIP_GIT=1; SKIP_BUILD=1; FORCE_INSTALL=1 ;;
    reinstall) SKIP_GIT=1; SKIP_BUILD=1; FORCE_REINSTALL=1 ;;
    install-compile) SKIP_GIT=1 ;;
    compile|scss|js) SKIP_GIT=1; SKIP_NPM=1; COMPILE_TARGET="$ACTION" ;;
    *) die "Unknown action" ;;
esac
IFS=':' read -r -a required_cartridges <<< "$DW_CARTRIDGES_PATH"

is_positive_int "$GIT_JOBS" || die "GIT_JOBS must be a positive integer"
is_positive_int "$REPO_JOBS" || die "REPO_JOBS must be a positive integer"
is_positive_int "$REINSTALL_DAYS" || die "REINSTALL_DAYS must be a positive integer"
validate_flag SKIP_GIT "$SKIP_GIT"
validate_flag SKIP_NPM "$SKIP_NPM"
validate_flag SKIP_BUILD "$SKIP_BUILD"
validate_flag CHANGED_ONLY "$CHANGED_ONLY"

# Keep persistent state outside repositories so git clean cannot remove it.
case "$LOG_FILE" in
    /*) ;;
    *) LOG_FILE="$ROOT_DIR/$LOG_FILE" ;;
esac
require_cmd git
for branch in "${priority_branches[@]}"; do
    git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "Invalid priority branch"
done

# Serialize whole script runs; repo workers still run in parallel.
run_lock="$ROOT_DIR/.dw-update.lock"
mkdir "$run_lock" 2>/dev/null || die "Another run is active, or stale lock exists: $run_lock"
sync_ok_dir=""
cleanup() {
    # Keep the run lock until all workers finish, including after a signal.
    local pid
    for pid in $(jobs -pr); do
        wait "$pid" 2>/dev/null || :
    done
    [ -z "$sync_ok_dir" ] || rm -rf -- "$sync_ok_dir"
    rmdir "$run_lock" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# One JSON log contains repo state and a snapshot for every cartridge.
# fcntl + atomic replace prevents parallel workers from losing log updates.
state() {
    python3 - "$LOG_FILE" "$ROOT_DIR" "$REINSTALL_DAYS" "$NODE_VERSION" "$@" <<'PYSTATE'
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

log_path, root, days, node_version, action, repo_name = sys.argv[1:7]
args = sys.argv[7:]
repo = Path(root) / repo_name if repo_name else Path(root)
log = Path(log_path).resolve()
# Validate on init, before any git clean or reset can run.
for candidate in Path(root).iterdir():
    if (candidate / "cartridges").is_dir() and (candidate / ".git").exists():
        if candidate.resolve() == log.parent or candidate.resolve() in log.parents:
            sys.exit("LOG_FILE must be outside repositories")
log.parent.mkdir(parents=True, exist_ok=True)

def git(*cmd):
    result = subprocess.run(["git", "-C", str(repo)] + list(cmd),
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    return result.stdout.strip() if result.returncode == 0 else None

def fingerprint():
    digest = hashlib.sha256()
    for name in ("package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock"):
        path = repo / name
        digest.update(name.encode() + b"\0")
        digest.update(path.read_bytes() if path.is_file() else b"<absent>")
    return digest.hexdigest()

def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

with open(str(log) + ".lock", "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    if log.exists():
        with log.open() as source:
            data = json.load(source)
        if data.get("schema_version") != 1 or not isinstance(data.get("repos"), dict):
            sys.exit("Unsupported or invalid log schema")
    else:
        data = {"schema_version": 1, "repos": {}}
    # Seed once; edits to this policy survive every later log update.
    default_skips = (
        "lib_productlist", "link_afterpay", "plugin_facebooktracking",
        "plugin_passwordlesslogin", "plugin_ordermonitoring",
        "plugin_pinteresttracking", "plugin_pushnotifications",
    )
    policies = data.setdefault("skip_repos", {
        name: {"skip_install": True, "skip_compile": True}
        for name in default_skips
    })
    if not isinstance(policies, dict):
        sys.exit("skip_repos must be an object keyed by repository name")
    for name, policy in policies.items():
        if not isinstance(policy, dict) or any(
            not isinstance(policy.get(key, False), bool)
            for key in ("skip_install", "skip_compile")
        ):
            sys.exit("Invalid skip policy for repo: " + name)
    if os.environ.get('DW_SKIP_REPOS_JSON'):
        policies = json.loads(os.environ['DW_SKIP_REPOS_JSON'])
        data['skip_repos'] = policies
    policy = policies.get(repo_name, {})
    skip_install = policy.get("skip_install", False)
    skip_compile = policy.get("skip_compile", False)
    if action == "policy":
        print(int(skip_install), int(skip_compile))
        sys.exit(0)
    entry = data["repos"].get(repo_name, {})
    for key in ("last_install_at", "last_install_epoch", "last_build_at"):
        entry.setdefault(key, None)
    now = time.time()
    dep_hash = fingerprint() if action != "init" else None
    if action == "plan":
        if skip_install or not (repo / "package.json").is_file():
            print("none")
        elif not (repo / "node_modules").is_dir():
            print("install")
        elif (not entry.get("last_install_epoch")
              or now - entry["last_install_epoch"] >= int(days) * 86400
              or entry.get("install_node_version") != node_version):
            print("reinstall")
        elif entry.get("install_status") != "ok" or entry.get("dependency_hash") != dep_hash:
            print("install")
        else:
            print("none")
        sys.exit(0)
    if action == "compile_plan":
        package_bytes = (repo / "package.json").read_bytes()
        package_hash = hashlib.sha256(package_bytes).hexdigest()
        script_cache = entry.get("compile_scripts", {})
        if script_cache.get("package_json_hash") == package_hash:
            print(*(int(task in script_cache["available"]) for task in
                    ("compile:scss", "compile:js")))
            sys.exit(0)
        package = json.loads(package_bytes)
        scripts = package.get("scripts", {})
        if not isinstance(scripts, dict):
            sys.exit("Invalid package.json scripts")
        available = [task for task in ("compile:scss", "compile:js")
                     if isinstance(scripts.get(task), str) and scripts[task].strip()]
        script_cache = {
            "package_json_hash": package_hash,
            "checked_at": utc_now(),
            "available": available,
            "skipped": {task: "no_script" for task in ("compile:scss", "compile:js")
                        if task not in available},
        }
    if action == "build_due":
        # Also recover from skipped/failed builds, even when git hasn't changed.
        due = (not skip_compile and (repo / "package.json").is_file() and (
            entry.get("build_status") != "ok"
            or entry.get("last_build_commit") != git("rev-parse", "HEAD")
            or entry.get("last_build_branch") != git("symbolic-ref", "--short", "HEAD")
            or entry.get("build_dependency_hash") != dep_hash
            or entry.get("build_node_version") != node_version))
        sys.exit(0 if due else 1)
    if action != "init":
        if os.environ.get("DW_RUN_ID"):
            if entry.get("run_id") != os.environ["DW_RUN_ID"]:
                entry["activity_steps"] = {"git": "pending", "install": "pending", "compile": "pending"}
            entry["run_id"] = os.environ["DW_RUN_ID"]
            steps = entry.setdefault("activity_steps", {})
            step = {"sync": "git", "install": "install", "build": "compile"}.get(action)
            if step and args:
                steps[step] = args[0]
            if action == "result":
                for key in ("git", "install", "compile"):
                    if steps.get(key) == "pending":
                        steps[key] = "blocked" if args[0] == "sync_failed" else "skipped"
        entry.update(skip_install=skip_install, skip_compile=skip_compile)
        entry.update(repo=repo_name, branch=git("symbolic-ref", "--short", "HEAD"),
                     commit=git("rev-parse", "HEAD"), last_run_at=utc_now())
        if action == "sync":
            entry["sync_status"] = args[0]
            entry["last_sync_at"] = utc_now()
            entry["run_status"] = "synced" if args[0] == "ok" else "sync_" + args[0]
        elif action == "install":
            entry["install_status"] = args[0]
            if args[0] in ("ok", "failed"):
                entry["last_install_attempt_at"] = utc_now()
            if args[0] == "ok":
                entry.update(last_install_at=utc_now(), last_install_epoch=now,
                             dependency_hash=dep_hash, install_node_version=node_version)
        elif action == "build":
            entry["build_status"] = args[0]
            if args[0] in ("ok", "failed"):
                entry["last_build_attempt_at"] = utc_now()
            if args[0] == "ok":
                entry.update(last_build_at=utc_now(), last_build_commit=entry["commit"],
                             last_build_branch=entry["branch"], build_dependency_hash=dep_hash,
                             build_node_version=node_version)
        elif action == "compile_plan":
            entry["compile_scripts"] = script_cache
        elif action == "result":
            entry["run_status"] = args[0]
        else:
            sys.exit("Unknown state action: " + action)
        # Install/build happen at repo level, so cartridges share their timestamps.
        entry["cartridges"] = {
            path.name: {key: value for key, value in entry.items() if key != "cartridges"}
            for path in sorted((repo / "cartridges").iterdir()) if path.is_dir()
        } if (repo / "cartridges").is_dir() else {}
        data["repos"][repo_name] = entry
    data["updated_at"] = utc_now()
    fd, temp_path = tempfile.mkstemp(prefix=log.name + ".", dir=str(log.parent))
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(data, output, indent=2, ensure_ascii=False)
            output.write("\n")
        os.replace(temp_path, log)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    if action == "compile_plan":
        print(*(int(task in script_cache["available"]) for task in
                ("compile:scss", "compile:js")))
PYSTATE
}

state init "" || die "Cannot initialize log: $LOG_FILE"
printf "${BLUE}Options:${NC} GIT_JOBS=%s REPO_JOBS=%s SKIP_GIT=%s SKIP_NPM=%s SKIP_BUILD=%s CHANGED_ONLY=%s REINSTALL_DAYS=%s NODE_VERSION=%s\n" \
    "$GIT_JOBS" "$REPO_JOBS" "$SKIP_GIT" "$SKIP_NPM" "$SKIP_BUILD" "$CHANGED_ONLY" "$REINSTALL_DAYS" "$NODE_VERSION"
printf "Log: %s\n" "$LOG_FILE"

# --- STEP 2: SCAN REPOS ---
printf "${BLUE}Scanning repositories...${NC}\n"
valid_repos=()

for dir in */; do
    [ ! -L "${dir%/}" ] || continue
    cartridges_dir="${dir}cartridges"
    [ -d "$cartridges_dir" ] || continue
    [ -e "${dir}.git" ] || continue

    match_found=false
    for req_cart in "${required_cartridges[@]}"; do
        if [ -d "$cartridges_dir/$req_cart" ]; then
            match_found=true
            break
        fi
    done

    if [ "$match_found" = true ]; then
        valid_repos+=("${dir%/}")
    fi
done

if [ ${#valid_repos[@]} -eq 0 ]; then
    printf "${YELLOW}No repos found.${NC}\n"
    exit 0
fi

printf "${GREEN}--> Found %d repos.${NC}\n" "${#valid_repos[@]}"

# --- STEP 3: GIT SYNC ---

printf "\n=== STAGE 1: GIT SYNC ===\n"
synced_repos=()

sync_ok_dir=$(mktemp -d "${TMPDIR:-/tmp}/dw-sync-ok.XXXXXX") || die "Cannot create temp dir"
# Command output is always silent; callers report completion/failure status.
run_quiet() {
    shift # First argument identifies the repo at call sites.
    "$@" >/dev/null 2>&1
}

# Concise completion messages, including failures, without command output.
print_status() {
    local step="$1" repo_name="$2" status="$3" detail="$4" color="$BLUE"
    case "$status" in
        OK) color="$GREEN" ;;
        FAIL) color="$RED" ;;
        SKIP|BLOCKED) color="$YELLOW" ;;
    esac
    printf "%b[%s]%b %s | %s: %s\n" "$color" "$status" "$NC" "$repo_name" "$step" "$detail"
}

run_git_sync() {
    local repo_name="$1"
    local repo_path="$ROOT_DIR/$repo_name"
    local curr target="" branch initial_head final_head

    curr=$(git -C "$repo_path" symbolic-ref --short HEAD 2>/dev/null) || curr="HEAD"
    initial_head=$(git -C "$repo_path" rev-parse HEAD 2>/dev/null) || return 1

    state sync "$repo_name" running || return 1
    # Fetch all branch heads, including branches excluded by single-branch clones.
    if ! run_quiet "$repo_name" git -C "$repo_path" fetch --prune origin '+refs/heads/*:refs/remotes/origin/*'; then
        return 1
    fi

    for branch in "${priority_branches[@]}"; do
        if git -C "$repo_path" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
            target="$branch"
            break
        fi
    done

    if [ -z "$target" ]; then
        return 1
    fi

    # Discard local changes only after fetch and target validation succeed.
    if ! run_quiet "$repo_name" git -C "$repo_path" config --replace-all remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' ||
       ! run_quiet "$repo_name" git -C "$repo_path" reset --hard HEAD ||
       ! run_quiet "$repo_name" git -C "$repo_path" clean -fd ||
       ! run_quiet "$repo_name" git -C "$repo_path" checkout -B "$target" "refs/remotes/origin/$target" ||
       ! run_quiet "$repo_name" git -C "$repo_path" reset --hard "refs/remotes/origin/$target" ||
       ! run_quiet "$repo_name" git -C "$repo_path" branch --set-upstream-to="origin/$target" "$target"; then
        return 1
    fi

    final_head=$(git -C "$repo_path" rev-parse HEAD 2>/dev/null) || return 1
    state sync "$repo_name" ok || return 1
    touch "$sync_ok_dir/$repo_name"
    if [ "$target" != "$curr" ] || [ "$initial_head" != "$final_head" ]; then
        touch "$sync_ok_dir/$repo_name.changed"
    fi
    print_status Git "$repo_name" OK "completed on $target"
    return 0
}

sync_repo() {
    if ! run_git_sync "$1"; then
        state sync "$1" failed
        state result "$1" sync_failed
        print_status Git "$1" FAIL "sync failed; install/compile excluded"
        return 1
    fi
}

if [ "$SKIP_GIT" = 1 ]; then
    printf "${YELLOW}SKIP_GIT=1: skip git sync.${NC}\n"
    synced_repos=("${valid_repos[@]}")
    for repo_name in "${valid_repos[@]}"; do
        state sync "$repo_name" skipped || die "Cannot update log"
        print_status Git "$repo_name" SKIP "SKIP_GIT=1"
    done
else
    printf "${YELLOW}Warning: this stage discards local changes with git reset --hard and git clean -fd.${NC}\n"
    printf "${BLUE}Running git sync with %s jobs.${NC}\n" "$GIT_JOBS"

    git_pids=()
    for repo_name in "${valid_repos[@]}"; do
        wait_for_slot "$GIT_JOBS"
        sync_repo "$repo_name" &
        git_pids+=($!)
    done

    if ! wait_for_pids "${git_pids[@]}"; then
        mark_fail
    fi

    for repo_name in "${valid_repos[@]}"; do
        [ -f "$sync_ok_dir/$repo_name" ] || continue

        synced_repos+=("$repo_name")
    done
fi

# This barrier waits for ALL Git workers before any install/compile starts.
if [ "$SKIP_GIT" = 1 ]; then
    print_status "Git stage" all SKIP "${#valid_repos[@]} repos; Git disabled"
else
    git_failed_count=$((${#valid_repos[@]} - ${#synced_repos[@]}))
    git_stage_status=OK
    [ "$git_failed_count" -eq 0 ] || git_stage_status=FAIL
    print_status "Git stage" all "$git_stage_status" "completed: ${#synced_repos[@]} succeeded, $git_failed_count failed"
fi

# Configured skips still get Git sync and per-cartridge log/status updates.
processing_repos=()
for repo_name in "${synced_repos[@]}"; do
    repo_policy=$(state policy "$repo_name") || die "Cannot read skip policy"
    read -r repo_skip_install repo_skip_compile <<< "$repo_policy"
    if [ "$repo_skip_install" = 1 ] && [ "$repo_skip_compile" = 1 ]; then
        state install "$repo_name" skipped || die "Cannot update log"
        state build "$repo_name" skipped || die "Cannot update log"
        state result "$repo_name" skipped_by_config || die "Cannot update log"
        print_status Install "$repo_name" SKIP "skip_install=true in log"
        print_status Compile "$repo_name" SKIP "skip_compile=true in log"
    else
        processing_repos+=("$repo_name")
    fi
done
synced_repos=("${processing_repos[@]}")

# CHANGED_ONLY still includes expired/missing dependencies and unfinished builds.
if [ "$CHANGED_ONLY" = 1 ]; then
    selected_repos=()
    for repo_name in "${synced_repos[@]}"; do
        install_plan=$(state plan "$repo_name") || die "Cannot read install state"
        if [ -f "$sync_ok_dir/$repo_name.changed" ] || [ "$install_plan" != none ]; then
            selected_repos+=("$repo_name")
        elif state build_due "$repo_name"; then
            selected_repos+=("$repo_name")
        else
            due_status=$?
            [ "$due_status" -eq 1 ] || die "Cannot read build state"
            state result "$repo_name" unchanged || die "Cannot update log"
            print_status "Install/compile" "$repo_name" SKIP "unchanged; dependencies and build are current"
        fi
    done
    synced_repos=("${selected_repos[@]}")
fi

if [ ${#synced_repos[@]} -eq 0 ]; then
    print_status "Install/compile stage" all SKIP "no repos require processing (or sync failed)"
    exit "$overall_status"
fi

# --- STEP 4: INSTALL & BUILD ---
printf "\n=== STAGE 2: INSTALL & BUILD ===\n"

# Git-only runs and repositories without package.json don't need Node/NVM.
needs_node=0
for repo_name in "${synced_repos[@]}"; do
    repo_policy=$(state policy "$repo_name") || die "Cannot read skip policy"
    read -r repo_skip_install repo_skip_compile <<< "$repo_policy"
    if [ -f "$ROOT_DIR/$repo_name/package.json" ] &&
       { { [ "$SKIP_NPM" != 1 ] && [ "$repo_skip_install" != 1 ]; } ||
         { [ "$SKIP_BUILD" != 1 ] && [ "$repo_skip_compile" != 1 ]; }; }; then
        needs_node=1
        break
    fi
done
if [ "$needs_node" = 1 ]; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    [ -s "$NVM_DIR/nvm.sh" ] || die "Missing nvm.sh"
    . "$NVM_DIR/nvm.sh"
    command -v nvm >/dev/null 2>&1 || die "Missing command: nvm"
    run_quiet "Node environment" nvm use "$NODE_VERSION" || die "Node $NODE_VERSION not found"
    require_cmd node
    require_cmd npm
fi

process_repo() {
    local repo_name="$1"
    local repo_path="$ROOT_DIR/$repo_name"
    local repo_status=0 task install_plan compile_count=0
    local compile_plan has_scss has_js task_available
    local repo_policy repo_skip_install repo_skip_compile
    repo_policy=$(state policy "$repo_name") || return 1
    read -r repo_skip_install repo_skip_compile <<< "$repo_policy"

    if [ ! -f "$repo_path/package.json" ]; then
        state result "$repo_name" no_package_json || return 1
        print_status "Install/compile" "$repo_name" SKIP "no package.json"
        return 0
    fi

    cd "$repo_path" || return 1
    export NODE_ENV=development

    if [ "$repo_skip_install" = 1 ]; then
        state install "$repo_name" skipped || return 1
        print_status Install "$repo_name" SKIP "skip_install=true in log"
    elif [ "$SKIP_NPM" = 1 ]; then
        print_status Install "$repo_name" SKIP "SKIP_NPM=1"
    else
        install_plan=$(state plan "$repo_name") || return 1
        [ "$FORCE_INSTALL" != 1 ] || install_plan=install
        [ "$FORCE_REINSTALL" != 1 ] || install_plan=reinstall
        if [ "$install_plan" != none ]; then
            if [ "$install_plan" = reinstall ]; then
                # Avoid following a symlink outside the repo.
                rm -rf -- "$repo_path/node_modules" || return 1
            fi
            state install "$repo_name" running || return 1
            if run_quiet "$repo_name" npm install; then
                state install "$repo_name" ok || return 1
                print_status Install "$repo_name" OK "$install_plan completed"
            else
                state install "$repo_name" failed || return 1
                print_status Install "$repo_name" FAIL "npm install failed"
                repo_status=1
            fi
        else
            print_status Install "$repo_name" SKIP "dependencies are current"
        fi
    fi

    if [ "$repo_status" -ne 0 ]; then
        state build "$repo_name" blocked || return 1
        print_status Compile "$repo_name" BLOCKED "install failed"
    elif [ "$repo_skip_compile" = 1 ]; then
        state build "$repo_name" skipped || return 1
        print_status Compile "$repo_name" SKIP "skip_compile=true in log"
    elif [ "$SKIP_BUILD" = 1 ]; then
        state build "$repo_name" skipped || return 1
        print_status Compile "$repo_name" SKIP "SKIP_BUILD=1"
    else
        if ! compile_plan=$(state compile_plan "$repo_name" 2>/dev/null); then
            state build "$repo_name" failed || return 1
            state result "$repo_name" failed || return 1
            print_status Compile "$repo_name" FAIL "cannot read compile plan"
            return 1
        fi
        state build "$repo_name" running || return 1
        read -r has_scss has_js <<< "$compile_plan"
        for task in "compile:scss" "compile:js"; do
            [ "$COMPILE_TARGET" != scss ] || [ "$task" = compile:scss ] || continue
            [ "$COMPILE_TARGET" != js ] || [ "$task" = compile:js ] || continue
            case "$task" in
                compile:scss) task_available="$has_scss" ;;
                compile:js) task_available="$has_js" ;;
            esac
            if [ "$task_available" = 1 ]; then
                compile_count=$((compile_count + 1))
                if run_quiet "$repo_name" npm run "$task"; then
                    print_status "$task" "$repo_name" OK "completed"
                else
                    print_status "$task" "$repo_name" FAIL "compile failed"
                    repo_status=1
                fi
            else
                print_status "$task" "$repo_name" SKIP "no script (saved in log)"
            fi
        done
        if [ "$repo_status" -eq 0 ]; then
            if [ "$COMPILE_TARGET" = scss ] || [ "$COMPILE_TARGET" = js ]; then
                state build "$repo_name" partial || return 1
            else
                state build "$repo_name" ok || return 1
            fi
            if [ "$compile_count" -eq 0 ]; then
                print_status Compile "$repo_name" SKIP "no compile scripts"
            else
                print_status Compile "$repo_name" OK "$compile_count tasks completed"
            fi
        else
            state build "$repo_name" failed || return 1
            print_status Compile "$repo_name" FAIL "one or more tasks failed"
        fi
    fi

    if [ "$repo_status" -eq 0 ]; then
        state result "$repo_name" ok || return 1
    else
        state result "$repo_name" failed || return 1
    fi
    return "$repo_status"
}

process_repo_worker() {
    if process_repo "$1"; then
        touch "$sync_ok_dir/$1.processed" || return 1
    else
        print_status "Install/compile" "$1" FAIL "processing failed"
        return 1
    fi
}

printf "${BLUE}Processing repos with %s jobs.${NC}\n" "$REPO_JOBS"
repo_pids=()

for repo_name in "${synced_repos[@]}"; do
    wait_for_slot "$REPO_JOBS"
    process_repo_worker "$repo_name" &
    repo_pids+=($!)
done

if ! wait_for_pids "${repo_pids[@]}"; then
    mark_fail
fi

processed_count=0
for repo_name in "${synced_repos[@]}"; do
    if [ -f "$sync_ok_dir/$repo_name.processed" ]; then
        processed_count=$((processed_count + 1))
    fi
done
process_failed_count=$((${#synced_repos[@]} - processed_count))
process_stage_status=OK
[ "$process_failed_count" -eq 0 ] || process_stage_status=FAIL
print_status "Install/compile stage" all "$process_stage_status" "completed: $processed_count succeeded, $process_failed_count failed"

if [ "$overall_status" -eq 0 ]; then
    printf "\n${GREEN}DONE ALL.${NC}\n"
else
    printf "\n${RED}DONE WITH ERRORS.${NC}\n"
fi

exit "$overall_status"
