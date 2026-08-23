#!/bin/sh
set -eu

required_email=code@svcomplex.ai
[ "$#" -gt 0 ] || {
  printf '%s\n' "usage: scripts/check-commit-emails.sh COMMIT..." >&2
  exit 64
}

for commit in "$@"; do
  git cat-file -e "$commit^{commit}"
  author_email=$(git show -s --format=%ae "$commit")
  committer_email=$(git show -s --format=%ce "$commit")
  if [ "$author_email" != "$required_email" ]; then
    printf 'error: commit %s author email is %s; expected %s\n' \
      "$commit" "$author_email" "$required_email" >&2
    exit 1
  fi
  if [ "$committer_email" != "$required_email" ]; then
    printf 'error: commit %s committer email is %s; expected %s\n' \
      "$commit" "$committer_email" "$required_email" >&2
    exit 1
  fi
done

printf 'verified commit email policy for %s commit(s)\n' "$#"
