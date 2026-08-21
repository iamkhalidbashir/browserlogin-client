BrowserLogin API guide

Runtime endpoints
REST base URL: <https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/api/v1>
MCP endpoint: <https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP>
Browser-authenticated archive route: <https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/browser-archives/:profileId>

Authentication and request rules
Authorization: Bearer <BROWSERLOGIN_API_KEY>
API key shape: bl_<KEY_ID>_<KEY_SECRET>

- Send the BrowserLogin API key as an exact Bearer value; missing, malformed, revoked, or unverifiable keys receive 401 with WWW-Authenticate: Bearer realm="BrowserLogin".
- JSON body requests require Content-Type application/json and are limited to 256 KiB.
- Use a non-empty Idempotency-Key of at most 100 characters wherever an operation lists that header.
- A supplied Origin must use HTTPS and the configured app hostname; server-to-server requests may omit Origin.
- Use placeholders such as <PROFILE_ID>, <SESSION_ID>, and <IDEMPOTENCY_KEY> in copied examples, never real credentials.

REST operations

Identity
GET /user
Summary: Get the current API user.
Access: authenticated API key
Request:
{}
Response:
{
"id": "<USER_ID>",
"name": "Workspace Owner",
"email": "<owner@example.com>",
"status": "active",
"owner": true,
"created_at": "2026-08-11T12:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}

GET /me
Summary: Alias for the current API user.
Access: authenticated API key
Request:
{}
Response:
{
"id": "<USER_ID>",
"name": "Workspace Owner",
"email": "<owner@example.com>",
"status": "active",
"owner": true,
"created_at": "2026-08-11T12:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}

GET /owner
Summary: Get workspace owner information.
Access: workspace owner
Request:
{}
Response:
{
"id": "<USER_ID>",
"name": "Workspace Owner",
"email": "<owner@example.com>",
"status": "active",
"owner": true,
"created_at": "2026-08-11T12:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}

Profiles
GET /profiles
Summary: List visible browser profiles.
Access: authenticated API key
Request:
{}
Response:
[{
"id": "<PROFILE_ID>",
"name": "Research profile",
"seed": 12345,
"proxy": {
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "https://provider.example/change-ip",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
},
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": null,
"locale": null,
"user_agent": null,
"viewport": null,
"args": ["--fingerprint-noise=false"],
"notes": "",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z",
"cloud": {
"role": "owner",
"config_version": 1,
"notes_version": 0,
"archive_generation": 0,
"session_generation": 0,
"current_session_id": null,
"deleted_at": null
}
}]

POST /profiles
Summary: Create a profile; optional proxy_id attaches a workspace proxy from GET /proxies.
Access: authenticated API key
Required headers: Idempotency-Key
Request:
{
"name": "Research profile",
"seed": 12345,
"proxy_id": "<PROXY_ID>",
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": "",
"locale": "",
"user_agent": "",
"viewport": null,
"args": ["--fingerprint-noise=false"]
}
Response:
{
"id": "<PROFILE_ID>",
"name": "Research profile",
"seed": 12345,
"proxy": {
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
},
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": null,
"locale": null,
"user_agent": null,
"viewport": null,
"args": ["--fingerprint-noise=false"],
"notes": "",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z",
"cloud": {
"role": "owner",
"config_version": 1,
"notes_version": 0,
"archive_generation": 0,
"session_generation": 0,
"current_session_id": null,
"deleted_at": null
}
}

GET /profiles/:profileId
Summary: Get one profile.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
{
"id": "<PROFILE_ID>",
"name": "Research profile",
"seed": 12345,
"proxy": {
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
},
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": null,
"locale": null,
"user_agent": null,
"viewport": null,
"args": ["--fingerprint-noise=false"],
"notes": "",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z",
"cloud": {
"role": "owner",
"config_version": 1,
"notes_version": 0,
"archive_generation": 0,
"session_generation": 0,
"current_session_id": null,
"deleted_at": null
}
}

PATCH /profiles/:profileId
Summary: Replace profile configuration using optimistic concurrency.
Access: profile editor
Request:
{
"expected_config_version": 1,
"name": "Research profile",
"proxy_id": "<PROXY_ID>",
"geoip": true,
"human_preset": "careful",
"bumblebee_profile": "natural"
}
Response:
{
"id": "<PROFILE_ID>",
"name": "Research profile",
"seed": 12345,
"proxy": {
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
},
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": null,
"locale": null,
"user_agent": null,
"viewport": null,
"args": ["--fingerprint-noise=false"],
"notes": "",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z",
"cloud": {
"role": "owner",
"config_version": 1,
"notes_version": 0,
"archive_generation": 0,
"session_generation": 0,
"current_session_id": null,
"deleted_at": null
}
}

DELETE /profiles/:profileId
Summary: Soft-delete a profile; its live sessions are force-stopped.
Access: workspace owner
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
{ "status": "deleted" }

POST /profiles/:profileId/restore
Summary: Restore a deleted profile.
Access: workspace owner
Request:
{}
Response:
{ "status": "restored" }

GET /profiles/:profileId/members
Summary: List profile members.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
[
{
"id": "<USER_ID>",
"name": "Editor",
"email": "editor@example.com",
"status": "active",
"role": "editor",
"created_at": "2026-08-11T12:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}
]

POST /profiles/:profileId/members
Summary: Share a profile.
Access: workspace owner
Request:
{ "user_id": "<USER_ID>", "role": "editor" }
Response:
{ "status": "shared" }

DELETE /profiles/:profileId/members/:userId
Summary: Remove a profile member; their sessions are force-stopped.
Access: workspace owner
Request:
{ "profile_id": "<PROFILE_ID>", "user_id": "<USER_ID>" }
Response:
{ "status": "removed" }

GET /profiles/:profileId/notes
Summary: Get current profile notes.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
{ "notes": "Current notes", "version": 2 }

POST /profiles/:profileId/notes
Summary: Append text to the current notes (newline-separated).
Access: profile editor
Request:
{ "notes": "New observation", "expected_version": 2 }
Response:
{ "version": 3 }

PUT /profiles/:profileId/notes
Summary: Replace the current notes entirely.
Access: profile editor
Request:
{ "notes": "Replacement notes", "expected_version": 2 }
Response:
{ "version": 3 }

GET /profiles/:profileId/notes/history
Summary: Get profile note history.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
[
{ "id": "<NOTE_VERSION_ID>", "version": 2, "notes": "Current notes", "created_by": "<USER_ID>", "created_at": "2026-08-11T12:00:00.000Z" }
]

GET /profiles/:profileId/notes-history
Summary: Alias for profile note history.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
[
{ "id": "<NOTE_VERSION_ID>", "version": 2, "notes": "Current notes", "created_by": "<USER_ID>", "created_at": "2026-08-11T12:00:00.000Z" }
]

POST /profiles/:profileId/sessions
Summary: Start a session and atomically acquire the profile lock; a second live session receives 409. The response carries the session, the complete profile configuration, the bound proxy's raw credentials, and the profile's current archive metadata (archive is null when none exists) so a desktop client can launch the cloak browser in one call and skip a separate archive lookup.
Access: profile editor
Required headers: Idempotency-Key
Request:
{}
Response:
{
"session": {
"id": "<SESSION_ID>",
"profile_id": "<PROFILE_ID>",
"generation": 1,
"state": "active",
"started_at": "2026-08-11T12:00:00.000Z",
"heartbeat_at": null,
"expires_at": null,
"force_stopped_at": null,
"stopped_at": null
},
"profile": {
"id": "<PROFILE_ID>",
"name": "Research profile",
"seed": 12345,
"proxy": {
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
},
"platform": "macos",
"geoip": true,
"humanize": true,
"human_preset": "careful",
"bumblebee_profile": "natural",
"headless": false,
"timezone": null,
"locale": null,
"user_agent": null,
"viewport": null,
"args": ["--fingerprint-noise=false"],
"notes": "",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z",
"cloud": {
"role": "owner",
"config_version": 1,
"notes_version": 0,
"archive_generation": 0,
"session_generation": 0,
"current_session_id": null,
"deleted_at": null
}
},
"archive": {
"profile_id": "<PROFILE_ID>",
"generation": 4,
"size": 1048576,
"sha256": "<64_HEX_CHARACTERS>",
"format": "zip",
"created_at": "2026-08-11T12:00:00.000Z"
}
}

GET /profiles/:profileId/archive
Summary: Get the profile's single current archive, or null.
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
Stored archive:
{
"archive": {
"profile_id": "<PROFILE_ID>",
"generation": 4,
"size": 1048576,
"sha256": "<64_HEX_CHARACTERS>",
"format": "zip",
"download_url": "/api/v1/profiles/<PROFILE_ID>/archive/download",
"created_at": "2026-08-11T12:00:00.000Z"
}
}

No archive:
{
"archive": null
}

GET /profiles/:profileId/archive/download
Summary: Stream the current archive bytes through API-key authentication. Supports an optional generation query parameter (409 when the current generation differs) and the If-Match header against the archive ETag (412 on mismatch).
Access: profile reader
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
Binary archive bytes with Content-Type, Content-Length, Content-Disposition, Cache-Control: no-store, X-Content-Type-Options: nosniff, and archive identity headers: ETag ("<SHA256_HEX>"), X-Archive-Generation, and Digest: sha-256=<BASE64_DIGEST>.

POST /profiles/:profileId/archive-upload-url
Summary: Get a short-lived Convex storage upload URL for the next profile archive, bound to the profile's active session; the caller must be the session holder or the workspace owner.
Access: profile editor
Request:
{}
Response:
{
"upload_url": "https://<CONVEX_STORAGE_UPLOAD_URL>",
"expires_at": "2026-08-11T12:15:00.000Z",
"session_id": "<SESSION_ID>"
}

Sessions
GET /sessions/:sessionId
Summary: Get session status.
Access: profile reader
Request:
{ "session_id": "<SESSION_ID>" }
Response:
{
"id": "<SESSION_ID>",
"profile_id": "<PROFILE_ID>",
"generation": 1,
"state": "active",
"started_at": "2026-08-11T12:00:00.000Z",
"heartbeat_at": null,
"expires_at": null,
"force_stopped_at": null,
"stopped_at": null
}

GET /sessions/:sessionId/status
Summary: Get session status explicitly.
Access: profile reader
Request:
{ "session_id": "<SESSION_ID>" }
Response:
{
"id": "<SESSION_ID>",
"profile_id": "<PROFILE_ID>",
"generation": 1,
"state": "active",
"started_at": "2026-08-11T12:00:00.000Z",
"heartbeat_at": null,
"expires_at": null,
"force_stopped_at": null,
"stopped_at": null
}

POST /sessions/:sessionId/stop
Summary: Stop the session, idempotent by Idempotency-Key: a retry with the same key and payload returns the original response, including the original archive_generation, without re-executing; the same key with a different payload receives 409. An optional archive payload commits the profile's single archive; force: true is owner-only and accepts no archive. The commit hashes the exact raw stored bytes server-side and compares the exact byte count and the lowercase hexadecimal SHA-256 against the submitted metadata, and archive replacement, session stopping, and lock release are one atomic operation — a validation or storage failure leaves the old archive unchanged and the session active. A verification failure receives 409 with error.code ARCHIVE_STORAGE_METADATA_MISMATCH plus a correlation request_id and safe details (mismatch, size_matches, sha256_matches, format_matches, storage_object_found, upload_bound_to_profile, upload_bound_to_session) identifying the failed invariant.
Access: session holder or workspace owner
Required headers: Idempotency-Key
Request:
{
"archive": {
"storage_id": "<STORAGE_ID>",
"size": 1048576,
"sha256": "<64_HEX_CHARACTERS>",
"format": "zip"
}
}
Response:
{
"id": "<SESSION_ID>",
"profile_id": "<PROFILE_ID>",
"generation": 1,
"state": "stopped",
"started_at": "2026-08-11T12:00:00.000Z",
"heartbeat_at": null,
"expires_at": null,
"force_stopped_at": null,
"stopped_at": "2026-08-11T12:05:00.000Z",
"status": "stopped",
"archive_generation": 4
}

Workspace administration
GET /proxies
Summary: List workspace HTTP/SOCKS5 proxies including credentials; ids feed proxy_id in profile create/update.
Access: workspace owner
Request:
{}
Response:
[{
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "https://provider.example/change-ip",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}]

POST /proxies
Summary: Create a workspace HTTP or SOCKS5 proxy. change_ip_url is optional.
Access: workspace owner
Required headers: Idempotency-Key
Request:
{
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>"
}
Response:
{
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}

PATCH /proxies/:proxyId
Summary: Replace a workspace proxy's configuration.
Access: workspace owner
Request:
{
"name": "Residential US East",
"protocol": "socks5",
"host": "proxy.example.com",
"port": 1080,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>"
}
Response:
{
"id": "<PROXY_ID>",
"name": "Residential US East",
"protocol": "http",
"host": "proxy.example.com",
"port": 8443,
"username": "proxy-user",
"password": "<PROXY_PASSWORD>",
"change_ip_url": "<https://provider.example/change-ip>",
"last_ip": "203.0.113.42",
"last_ip_changed_at": "2026-08-11T12:00:00.000Z",
"created_at": "2026-08-11T11:00:00.000Z",
"updated_at": "2026-08-11T12:00:00.000Z"
}

DELETE /proxies/:proxyId
Summary: Delete a proxy and detach it from browser profiles.
Access: workspace owner
Request:
{ "proxy_id": "<PROXY_ID>" }
Response:
{ "status": "deleted" }

POST /proxies/:proxyId/change-ip
Summary: Rotate the proxy server-side: GET the optional change_ip_url, then detect the new exit IP through the proxy via public IP echo services when the provider response carries none. Stores last_ip and last_ip_changed_at and returns the change result. The returned ip is optional: an acknowledged rotation whose IP can be neither parsed nor detected succeeds with ip null and ip_verified false.
Access: workspace owner
Request:
{}
Response:
{
"id": "<PROXY_ID>",
"ip": "203.0.113.42",
"changed_at": "2026-08-11T12:00:00.000Z",
"ip_verified": true
}

GET /api-keys
Summary: List API keys owned by the authenticated account. API keys cannot create, rotate, or revoke API keys.
Access: authenticated API key owner
Request:
{}
Response:
[
{
"id": "<API_KEY_ID>",
"name": "Automation client",
"prefix": "bl_<KEY_ID>",
"status": "active",
"expires_at": null,
"last_used_at": "2026-08-11T12:00:00.000Z",
"revoked_at": null,
"created_at": "2026-08-11T11:00:00.000Z"
}
]

GET /users
Summary: List workspace users.
Access: workspace owner
Request:
{}
Response:
[
{ "id": "<USER_ID>", "name": "Editor", "email": "editor@example.com", "status": "active", "owner": false }
]

POST /users/:userId/disable
Summary: Disable a workspace user; their sessions are force-stopped.
Access: workspace owner
Request:
{}
Response:
{ "status": "disabled" }

GET /audit
Summary: List audit events, optionally filtered with the profile_id query parameter.
Access: workspace owner; profile reader when profile_id is supplied
Request:
{ "profile_id": "<PROFILE_ID>" }
Response:
[
{ "action": "profile.updated", "entity_type": "browserProfile", "entity_id": "<PROFILE_ID>", "actor_user_id": "<USER_ID>", "created_at": "2026-08-11T12:00:00.000Z" }
]

MCP contract
Endpoint: <https://noble-spark-8295-06576bc2.app-csite-env.sapps.co/mcp/browserSessionMCP>
Server: browserSessionMCP 2.1.0
Transport: MCP Streamable HTTP, stateless JSON responses
Protocol versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05
Methods: initialize, notifications/initialized, ping, tools/list, tools/call

- Standard MCP Streamable HTTP: POST single JSON-RPC 2.0 messages and receive application/json responses. Notifications receive 202 with an empty body.
- GET and DELETE return 405 because the server is stateless and offers no SSE stream or protocol session; do not send Mcp-Session-Id.
- initialize negotiates the protocol version: a supported requested version is echoed, otherwise the server answers with its newest supported version.
- There are no custom method or tool headers; the JSON-RPC method and params alone drive dispatch, so stock MCP clients connect directly.
- List-tool results are wrapped as { result: [...] } in structuredContent because the MCP specification requires structuredContent to be an object.
- Require Content-Type application/json; the maximum JSON body is 256 KiB.
- A supplied Origin must use HTTPS and the configured app hostname; server-to-server requests may omit Origin.
- Authenticate every request with the BrowserLogin API key as an exact Bearer value.

MCP tools

Profiles
profiles_list: List visible profiles.
Access: authenticated API key
Arguments: No tool-specific arguments.
profile_get: Get one profile.
Access: profile reader
Arguments: profile_id
profile_create: Create a profile; optional proxy_id attaches a workspace proxy.
Access: authenticated API key
Arguments: idempotency_key; name; optional seed, proxy_id, platform, geoip, humanize, human_preset, bumblebee_profile, headless, timezone, locale, user_agent, viewport, args
profile_update: Update profile configuration.
Access: profile editor
Arguments: profile_id; expected_config_version; name; optional seed, proxy_id, platform, geoip, humanize, human_preset, bumblebee_profile, headless, timezone, locale, user_agent, viewport, args
profile_delete: Delete a profile.
Access: workspace owner
Arguments: profile_id
profile_restore: Restore a deleted profile.
Access: workspace owner
Arguments: profile_id

Notes and proxies
notes_get: Get current profile notes; MCP does not expose note history.
Access: profile reader
Arguments: profile_id
notes_append: Append text to the current notes with optimistic concurrency.
Access: profile editor
Arguments: profile_id; notes; expected_version
notes_update: Replace the current notes entirely with optimistic concurrency.
Access: profile editor
Arguments: profile_id; notes; expected_version
proxies_list: List workspace HTTP/SOCKS5 proxies with credentials redacted (passwords are never exposed to tools); ids feed proxy_id in profile create/update.
Access: workspace owner
Arguments: No tool-specific arguments.
proxy_change_ip: Calls the proxy's change-IP URL server-side, detects the new exit IP through the proxy when the provider response has none, stores it as last_ip, and returns it. The returned ip is optional: an acknowledged rotation whose IP cannot be verified succeeds with ip null and ip_verified false.
Access: workspace owner
Arguments: proxy_id

Members, users, and audit
members_list: List profile members.
Access: profile reader
Arguments: profile_id
member_share: Share with an editor or viewer.
Access: workspace owner
Arguments: profile_id; user_id; role: editor or viewer
member_remove: Remove a profile member.
Access: workspace owner
Arguments: profile_id; user_id
users_list: List workspace users.
Access: workspace owner
Arguments: No tool-specific arguments.
user_disable: Disable a workspace user.
Access: workspace owner
Arguments: user_id
audit_list: List audit events, optionally filtered by profile.
Access: workspace owner; profile reader when profile_id is supplied
Arguments: optional profile_id

Session and archive workflow

1. Start the session: Starting atomically acquires the profile lock and marks the session active. A second start while any live session holds the profile fails with 409; there is no activation call and no heartbeat to maintain. The response includes the complete profile configuration, the bound proxy's raw credentials, and the current archive metadata so the desktop client can hand everything to the cloak browser and decide on a fresh download without a second request.
   REST: POST /profiles/:profileId/sessions
   Required headers: Idempotency-Key
2. Request an upload URL: Ask for a short-lived Convex storage upload URL bound to the profile's active session. The caller must be the session holder or the workspace owner, and the response echoes the bound session_id.
   REST: POST /profiles/:profileId/archive-upload-url
3. Upload archive bytes: POST the plain chrome profile archive directly to upload_url and keep storageId from the upload response. Archives are stored unencrypted, exactly as uploaded.
4. Stop with the archive: Stop with archive metadata and an Idempotency-Key. archive.size must be the exact byte count of the uploaded bytes and archive.sha256 their lowercase hexadecimal SHA-256 (exactly 64 hex characters). BrowserLogin independently hashes the raw stored bytes and compares them before committing; the response includes archive_generation when committed. Archive replacement, session stopping, and lock release are one atomic operation: a validation or storage failure leaves the old archive unchanged and the session active. A verification failure returns 409 ARCHIVE_STORAGE_METADATA_MISMATCH with a request_id and per-invariant match flags. Retrying with the same key and payload returns the original response with the original archive_generation, so a lost HTTP response never double-commits.
   REST: POST /sessions/:sessionId/stop
   Fields: archive.storage_id, archive.size: exact byte count, archive.sha256: lowercase hex SHA-256 of the exact bytes, archive.format: zip, tar.gz, or octet-stream
   Required headers: Idempotency-Key
5. Force stop without an archive: A workspace owner can force-stop any session with force: true. The lock is released immediately and the previous holder can no longer commit an archive. Force stops are idempotent by Idempotency-Key like normal stops.
   REST: POST /sessions/:sessionId/stop
   Fields: force: true
   Required headers: Idempotency-Key

Security and lifecycle caveats

- Archives are stored unencrypted: BrowserLogin accepts and stores the plain archive bytes exactly as uploaded. Before every commit BrowserLogin independently hashes the exact raw stored bytes and compares the exact byte count and the lowercase hexadecimal SHA-256 (64 hex characters) against the submitted metadata, but does not encrypt or decrypt archive contents.
- Archive verification failures return 409 with error.code ARCHIVE_STORAGE_METADATA_MISMATCH, a correlation request_id, and safe per-invariant details (mismatch, size_matches, sha256_matches, format_matches, storage_object_found, upload_bound_to_profile, upload_bound_to_session). Credentials, signed URLs, storage ids, and full digests are never included; detailed comparison values are logged server-side under the same request_id.
- One archive is stored directly on each profile. Every successful commit replaces and permanently deletes the previous archive bytes.
- Session stop guarantees: a validation or storage failure leaves the old archive unchanged, a failed stop leaves the session active, and archive replacement, session stopping, and lock release are one atomic operation.
- Session stop is idempotent by Idempotency-Key: a retry with the same key and payload returns the original response with the original archive_generation; failed stops are never cached, so a corrected retry with the same key executes fresh.
- Download automation bytes with GET /profiles/:profileId/archive/download. Responses carry ETag, X-Archive-Generation, and Digest identity headers and honor the generation query parameter (409) and If-Match (412) for generation-specific downloads. The signed-in workspace UI uses /browser-archives/:profileId.
- Sessions have no heartbeat or expiry sweep. A session stays active until it is stopped or force-stopped.
- HTTP/SOCKS5 proxies are workspace-owned. REST responses for owner API keys include raw proxy credentials so desktop clients can launch browsers; MCP tool outputs always redact proxy usernames and passwords because they are consumed by LLMs.
- change_ip_url is optional. Change IP rotates server-side (never client-side): it performs the upstream GET, then detects the new exit IP through the proxy via public IP echo services when the provider response carries no IP, stores last_ip and last_ip_changed_at, and returns the change result. The returned ip is optional — when the provider acknowledges the rotation but the new IP can be neither parsed from the response nor detected through the proxy, the call still succeeds with ip null and ip_verified false (last_ip is cleared as stale). It fails only when the proxy has no change_ip_url or the provider endpoint rejects the request.
- GeoIP alignment defaults on. Locale and timezone are optional and auto-set from the exit IP when GeoIP alignment is enabled.
- When omitted, human_preset defaults to careful and bumblebee_profile defaults to natural. Omitted viewport uses the desktop resolution.
- API keys can be created, rotated, or revoked only from the signed-in workspace UI. An API key cannot manage API keys through REST or MCP.
- The MCP endpoint exposes profile, notes, proxy, member, user, and audit tools only. Session start/stop and archive transfer are REST-only.
