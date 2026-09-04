#!/bin/sh
set -eu

WEBINAR_IT_CONTAINER="webinar-studio-it-$(openssl rand -hex 12)"
WEBINAR_IT_REMOVE_ARMED=0
WEBINAR_IT_SECRET_DIR=''
WEBINAR_IT_SECRET_FILE=''

validate_webinar_container_name() {
  case "$1" in
    webinar-studio-it-????????????????????????) ;;
    *) return 1 ;;
  esac
  WEBINAR_IT_SUFFIX=${1#webinar-studio-it-}
  case "$WEBINAR_IT_SUFFIX" in
    *[!0-9a-f]*) return 1 ;;
  esac
}

cleanup_webinar_it() {
  WEBINAR_IT_CLEANUP_STATUS=0
  if [ "$WEBINAR_IT_REMOVE_ARMED" = '1' ]; then
    if docker rm --force "$WEBINAR_IT_CONTAINER" >/dev/null 2>&1; then
      printf '%s\n' "Removed disposable MySQL container $WEBINAR_IT_CONTAINER"
    else
      WEBINAR_IT_CLEANUP_STATUS=1
    fi
    WEBINAR_IT_REMOVE_ARMED=0
  fi

  unset WEBINAR_TEST_DATABASE_URL WEBINAR_IT_PASSWORD
  if [ -n "$WEBINAR_IT_SECRET_FILE" ]; then
    rm -f -- "$WEBINAR_IT_SECRET_FILE" || WEBINAR_IT_CLEANUP_STATUS=1
    WEBINAR_IT_SECRET_FILE=''
  fi
  if [ -n "$WEBINAR_IT_SECRET_DIR" ]; then
    rmdir -- "$WEBINAR_IT_SECRET_DIR" || WEBINAR_IT_CLEANUP_STATUS=1
    WEBINAR_IT_SECRET_DIR=''
  fi
  return "$WEBINAR_IT_CLEANUP_STATUS"
}

exit_with_cleanup() {
  WEBINAR_IT_PRIMARY_STATUS=$?
  trap - EXIT INT TERM HUP
  WEBINAR_IT_FINAL_CLEANUP_STATUS=0
  cleanup_webinar_it || WEBINAR_IT_FINAL_CLEANUP_STATUS=$?
  if [ "$WEBINAR_IT_PRIMARY_STATUS" -ne 0 ]; then
    exit "$WEBINAR_IT_PRIMARY_STATUS"
  fi
  exit "$WEBINAR_IT_FINAL_CLEANUP_STATUS"
}

trap exit_with_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if ! validate_webinar_container_name "$WEBINAR_IT_CONTAINER"; then
  printf '%s\n' 'Generated disposable MySQL container name is unsafe' >&2
  exit 64
fi
if docker container inspect "$WEBINAR_IT_CONTAINER" >/dev/null 2>&1; then
  printf '%s\n' 'Refusing to reuse an existing integration container' >&2
  exit 1
fi

WEBINAR_IT_SECRET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/webinar-studio-it.XXXXXX")"
chmod 700 "$WEBINAR_IT_SECRET_DIR"
WEBINAR_IT_SECRET_FILE="$WEBINAR_IT_SECRET_DIR/mysql-root-password"
umask 077
openssl rand -hex 32 > "$WEBINAR_IT_SECRET_FILE"

# Arm name-based cleanup before creation. A failed `docker create` may still
# have created the uniquely named container before the client observed failure.
WEBINAR_IT_REMOVE_ARMED=1
docker create --name "$WEBINAR_IT_CONTAINER" \
  --publish '127.0.0.1::3306' \
  --mount "type=bind,source=${WEBINAR_IT_SECRET_FILE},target=/run/secrets/mysql-root-password,readonly" \
  --env MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root-password \
  --health-cmd='MYSQL_PWD="$(cat /run/secrets/mysql-root-password)" mysqladmin ping --host=127.0.0.1 --user=root --silent' \
  --health-interval=1s --health-timeout=5s --health-retries=90 \
  mysql:8.0 >/dev/null
docker start "$WEBINAR_IT_CONTAINER" >/dev/null

WEBINAR_IT_STATUS='starting'
WEBINAR_IT_ATTEMPT=1
while [ "$WEBINAR_IT_ATTEMPT" -le 90 ]; do
  WEBINAR_IT_STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$WEBINAR_IT_CONTAINER")"
  [ "$WEBINAR_IT_STATUS" = 'healthy' ] && break
  [ "$WEBINAR_IT_STATUS" = 'unhealthy' ] && break
  sleep 1
  WEBINAR_IT_ATTEMPT=$((WEBINAR_IT_ATTEMPT + 1))
done
test "$WEBINAR_IT_STATUS" = 'healthy'

WEBINAR_IT_PORT="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}' "$WEBINAR_IT_CONTAINER")"
case "$WEBINAR_IT_PORT" in
  ''|*[!0-9]*)
    printf '%s\n' 'Docker returned an unsafe disposable MySQL port' >&2
    exit 65
    ;;
esac

IFS= read -r WEBINAR_IT_PASSWORD < "$WEBINAR_IT_SECRET_FILE"
export WEBINAR_TEST_DATABASE_URL="mysql://root:${WEBINAR_IT_PASSWORD}@127.0.0.1:${WEBINAR_IT_PORT}/mysql"
printf '%s\n' "Running Webinar Studio integration in $WEBINAR_IT_CONTAINER on 127.0.0.1:$WEBINAR_IT_PORT"
npx vitest run --config vitest.webinar-integration.config.js \
  tests/integration/webinarStudioFoundation.integration.test.js
