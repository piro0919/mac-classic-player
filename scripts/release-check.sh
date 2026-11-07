#!/usr/bin/env bash
# `npm run release` の前に確かめる。上げるものが、1つのコミットと1つの版数に
# 結びつかないときは止める（chappie-desktop の scripts/release-check.sh と同じ考え方）。
#
#   scripts/release-check.sh create   gh release create の前
#   scripts/release-check.sh upload   gh release upload の前
#
# 確かめること:
#   - 追跡しているファイルに未コミットの変更がない
#   - HEAD が origin/main に入っている（札は --target HEAD で付けるので、push 済みでないと付けられない）
#   - package.json と src-tauri/tauri.conf.json の版数が一致している
#   - 札 v<版数> がすでにあるなら、手元でも origin でも HEAD を指している
#   - upload では、札が origin にあり、ビルドしたアプリの版数が一致している
set -euo pipefail

stage="${1:-}"
if [[ "$stage" != "create" && "$stage" != "upload" ]]; then
  echo "usage: $0 create|upload" >&2
  exit 2
fi

cd "$(git rev-parse --show-toplevel)"

fail() {
  echo "release-check: $*" >&2
  exit 1
}

dirty="$(git status --porcelain --untracked-files=no)"
if [[ -n "$dirty" ]]; then
  echo "$dirty" >&2
  fail "追跡しているファイルに未コミットの変更があります。コミットしてから上げてください"
fi
untracked="$(git status --porcelain | grep '^??' || true)"
if [[ -n "$untracked" ]]; then
  echo "release-check: 追跡していないファイルがあります（配るものには入りません）:" >&2
  echo "$untracked" >&2
fi

head="$(git rev-parse HEAD)"
git fetch -q origin main
git merge-base --is-ancestor "$head" origin/main ||
  fail "HEAD ($head) が origin/main に入っていません。push してから上げてください"

pkg_version="$(node -p "require('./package.json').version")"
tauri_version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
if [[ "$pkg_version" != "$tauri_version" ]]; then
  fail "package.json は $pkg_version、tauri.conf.json は $tauri_version です"
fi

tag="v$pkg_version"

if local_sha="$(git rev-parse -q --verify "refs/tags/$tag^{commit}")"; then
  [[ "$local_sha" == "$head" ]] || fail "手元の札 $tag は $local_sha を指していて、HEAD ($head) ではありません"
fi

# 注釈付きの札でもコミットで比べられるよう、剥いた行（^{}）を先に見る
remote_sha="$(git ls-remote --tags origin "refs/tags/$tag^{}" | cut -f1)"
if [[ -z "$remote_sha" ]]; then
  remote_sha="$(git ls-remote --tags origin "refs/tags/$tag" | cut -f1)"
fi
if [[ -n "$remote_sha" && "$remote_sha" != "$head" ]]; then
  fail "origin の札 $tag は $remote_sha を指していて、HEAD ($head) ではありません"
fi

if [[ "$stage" == "upload" ]]; then
  [[ -n "$remote_sha" ]] || fail "札 $tag が origin にありません。先に release:create を走らせてください"
  plist="src-tauri/target/release/bundle/macos/Mac Classic Player.app/Contents/Info.plist"
  [[ -f "$plist" ]] || fail "$plist がありません。先にリリース用のビルドをしてください"
  built="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$plist")"
  [[ "$built" == "$pkg_version" ]] || fail "ビルドしたアプリは $built、package.json は $pkg_version です。ビルドし直してください"
fi

echo "release-check ($stage): $tag at $head"
