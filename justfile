APP := "entity"

# Start the editor and follow its log (Ctrl-C leaves the editor running).
run: start
    portly logs {{APP}} frontend

# Start in the background.
start:
    portly run {{APP}} -s frontend -c "npm run dev -- --port {PORT}"
    @portly status {{APP}}

run-frontend: run

stop:
    portly stop {{APP}}

restart: stop run

install:
    npm ci

build:
    npm run build

test:
    npm test

check: test build

logs:
    portly logs {{APP}} frontend

open:
    portly open {{APP}} frontend

# Register once on a new machine; --next picks an available port.
register:
    portly register {{APP}} -p frontend=5177 --next --free

# Run interaction checks in Playwright Chromium (editor must be running).
test-browser:
    ENTITY_BASE_URL="http://localhost:$(portly get {{APP}} frontend)" npm run test:browser
