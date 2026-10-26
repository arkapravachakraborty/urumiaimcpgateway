# WooCommerce REST Authentication & In-Cluster HTTP Pitfall

## The Pitfall

When integrating MCP servers or services (such as `@repo/gateway` or temporary diagnostic pods) with WooCommerce's REST API inside a Kubernetes cluster, a common failure occurs:

```json
{
  "code": "woocommerce_rest_cannot_view",
  "message": "Sorry, you cannot list resources.",
  "data": {
    "status": 401
  }
}
```
Or an unexpected redirect to `https://` / HTTP 403 Forbidden.

### Why This Happens

1. **WooCommerce Basic Auth SSL Requirement**:
   WooCommerce REST API (`class-wc-rest-authentication.php`) by design requires HTTPS when authenticating requests via HTTP Basic Authentication (`consumer_key` / `consumer_secret`). If `is_ssl()` returns `false`, WooCommerce immediately denies Basic Auth.

2. **In-Cluster Plain HTTP Traffic**:
   Inside Kubernetes, services communicate over ClusterIP services (e.g., `http://wordpress:80/wp-json/wc/v3/...`) using unencrypted HTTP.

3. **Reverse Proxy SSL Termination**:
   Ingress controllers (such as Traefik or NGINX) terminate TLS at the cluster edge and forward requests as HTTP to the upstream pods with header `X-Forwarded-Proto: https` (or `http` on local dev port 8080). Standard WordPress Docker images do not automatically inspect `HTTP_X_FORWARDED_PROTO` unless instructed to do so.

4. **Apache Authorization Header Stripping**:
   Standard Apache configurations often strip the `Authorization: Basic ...` header before PHP processes the request, leaving `$_SERVER['PHP_AUTH_USER']` and `$_SERVER['PHP_AUTH_PW']` empty.

---

## The Solution

We solve this cleanly via `WORDPRESS_CONFIG_EXTRA` in the WordPress Deployment manifest, which injects the following PHP code into `wp-config.php`:

```php
// 1. Honor Reverse Proxy SSL Termination
if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

// 2. Allow Local Development & In-Cluster Testing without TLS
if (isset($_SERVER['HTTP_HOST']) && strpos($_SERVER['HTTP_HOST'], 'localtest.me') !== false) {
    $_SERVER['HTTPS'] = 'on';
}

// 3. Fallback: Parse Authorization Header if stripped by Apache
if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
    list($type, $cred) = explode(' ', $_SERVER['HTTP_AUTHORIZATION'], 2);
    if (strtolower($type) === 'basic') {
        list($user, $pass) = explode(':', base64_decode($cred), 2);
        $_SERVER['PHP_AUTH_USER'] = $user;
        $_SERVER['PHP_AUTH_PW'] = $pass;
    }
}
```

### Verification from a Temporary Pod

From within the Kubernetes cluster, internal callers query the WordPress service passing the public `Host` header and Basic Auth credentials:

```bash
# Obtain consumer key and secret from the Kubernetes Secret
CK=$(kubectl get secret woocommerce-api-secret -o jsonpath='{.data.consumer-key}' | base64 -d)
CS=$(kubectl get secret woocommerce-api-secret -o jsonpath='{.data.consumer-secret}' | base64 -d)

# Run a temporary curl pod to verify /wp-json/wc/v3/products works:
kubectl run curl-test --rm -i --restart=Never --image=curlimages/curl -- \
  curl -s -u "${CK}:${CS}" \
  -H "Host: shop.localtest.me:8080" \
  -H "X-Forwarded-Proto: https" \
  http://wordpress/wp-json/wc/v3/products
```

This ensures full compatibility both for internal cluster services and through the public Ingress.
