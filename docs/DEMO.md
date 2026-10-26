# Definition of Done demo

This walkthrough demonstrates the storefront, member chat, external MCP access,
revocation, upstream isolation, health recovery, and audit attribution. It is
written for a local k3d deployment and can be followed in order while recording.

## Before recording

1. From the repository root, start the local platform:

   ```sh
   bash scripts/up.sh
   ```

2. Wait until `kubectl get pods -n platform` reports every pod Ready. Check
   both ingresses with `kubectl get ingress -n platform`.
3. If you want to demonstrate chat, configure a valid `LLM_API_KEY` (and, if
   needed, `LLM_PROVIDER`, `LLM_MODEL`, or `LLM_BASE_URL`) in `.env`,
   then run `bash scripts/create-secrets.sh` and restart the gateway:

   ```sh
   kubectl rollout restart deployment/gateway -n platform
   kubectl rollout status deployment/gateway -n platform --timeout=5m
   ```

4. Open `http://dashboard.localtest.me:8080/login` and sign in with
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` from the ignored `.env` file. Do not
   show or paste passwords/API keys into the recording.
5. Confirm `http://shop.localtest.me:8080` loads the WooCommerce storefront.

## 1. Place a COD order and confirm it in WooCommerce admin

Manual browser steps:

1. Open the storefront in a private/incognito window and add the sample product
   to the cart. If it is absent, wait for the store setup Job to complete and
   reload.
2. Complete checkout with a test name, email, and address. Select **Cash on
   delivery (COD)** and place the order.
3. Open `http://shop.localtest.me:8080/wp-admin`, sign in with WordPress
   `WORDPRESS_ADMIN_PASSWORD` from `.env`, and open **WooCommerce →
   Orders**. Show the new order and note its order ID for the later checks.

Do not use real payment or personal details in a demo.

## 2. User A creates a product and asks about today's orders in chat

Manual dashboard steps:

1. As admin, open **Members**, create Member A, and copy the temporary
   password. Sign out and sign in as Member A.
2. Open **Chat** and ask:

   > Create a published product named Demo Mug priced 12.50.

3. Show the `woo__create_product` tool card and successful result. Open the
   storefront and verify Demo Mug appears.
4. Ask:

   > What orders came in today?

5. Show the `woo__list_orders` tool card and confirm it includes the COD order
   placed in step 1 (the WooCommerce tool's `today` range is UTC).

## 3. User B uses only the gateway URL and their API key

1. Sign in as admin, create Member B, then sign in as B and open **Keys**.
   Generate a key and copy it once.
2. For direct tools, open MCP Inspector, select **Streamable HTTP**, set the
   server URL to `http://dashboard.localtest.me:8080/mcp`, and add the request
   header `Authorization: Bearer <B's key>`. No upstream URL or upstream
   credential is given to the client. To demonstrate natural-language
   prompting, use a model-enabled MCP host such as Claude Code and paste the
   Claude Code configuration snippet shown once by the dashboard's key dialog.
3. Connect and show the prefixed tools for each enabled server:
   `woo__...`, `notes__...`, and `utils__...`.
4. Call `woo__list_orders` with `{"today":true}` and confirm the COD order.
5. Call `utils__current_time`. In the model-enabled host, ask one prompt that
   needs both WooCommerce orders and the utils current time, for example:

   > What orders came in today? Also tell me the current UTC time.

   Confirm the host invokes both `woo__list_orders` and
   `utils__current_time`. MCP Inspector lists and invokes tools but is not
   itself a language model; use it for the direct calls above.

## 4. Revoke B's key and prove immediate rejection

While signed in as B, open **Keys** and revoke the key. Repeat the MCP
`tools/list` request (or any MCP request) with the same bearer value. It must
return **HTTP 401**. The gateway checks key revocation on every request.

## 5. Disable an upstream and verify tools disappear

As admin, open **Servers**, disable **Notes**, then refresh the server list and
the MCP Inspector tool list. `notes__...` tools should disappear. Open Chat as
a member and start a new message; each chat request fetches the current tools,
so the disabled notes tools should not be offered there either. Re-enable Notes
after the demonstration.

## 6. Stop and recover the WooCommerce MCP pod

As admin, open **Servers** and keep the WooCommerce status visible. In a
terminal, delete only one Woo MCP pod:

```sh
kubectl delete pod -n platform \
  -l app.kubernetes.io/component=woo-mcp \
  --wait=false
```

The Deployment creates a replacement pod. Wait for the health checker (15
second interval) to mark WooCommerce **Unreachable**, then **Connected** after
the replacement is ready. During the outage, call `utils__current_time` from
MCP Inspector to show another upstream remains usable. The gateway should omit
Woo tools while its status is Unreachable; the dashboard displays the same
status.

## 7. Confirm audit attribution

Sign in as admin and open **Audit**. Show that calls from User A's dashboard
chat have source `chat`, while User B's external MCP calls have source `mcp`.
Confirm the user, server, tool, status, and duration columns match the actions
performed above.

## Automated checks

With the local cluster and gateway available, this API-level script creates
isolated test members, logs them in, issues a User B key, exercises prefixed
tools from WooCommerce and utils, tests network-policy isolation, disables and
re-enables Notes, deletes one Woo MCP pod and waits for recovery, checks audit
attribution, and revokes B's key to verify the next request returns 401:

```sh
bash scripts/e2e.sh
```

It reads admin credentials from `.env` (or the environment), creates
uniquely named disposable test accounts in the database, and does not print
the API key. Set `E2E_GATEWAY_URL` and `E2E_NAMESPACE` to override local
defaults. Set `EXPECTED_ORDER_ID` to also assert that `woo__list_orders` returns
the manual order placed in step 1.

With a working chat provider, set `E2E_CHAT=true` to additionally have User A
create a unique product through `/api/chat`, verify it through WooCommerce,
and check that its audit row is attributed to User A with source `chat`. When
`EXPECTED_ORDER_ID` is also set, the script asks User A's chat for today's
orders and checks that the order ID appears in the streamed response. Without
a configured provider, perform step 2 manually.

The storefront checkout and WordPress admin verification require a browser and
remain manual. The script's non-gateway network test depends on the active
cluster CNI enforcing Kubernetes NetworkPolicies.
