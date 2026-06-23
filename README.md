# Cross Account Plugin for AWS CDK

The [AWS CDK](https://docs.aws.amazon.com/cdk/index.html) supports authentication extensions through [plugins](https://docs.aws.amazon.com/cdk/v2/guide/cli.html#cli-config-plugin). This plugin enables complex multi-account authentication scenarios that are not natively supported by the CDK CLI, including named profiles with IAM role assumption, MFA, and AWS SSO.

---

## Features

- **Named profile support** — map CDK accounts to `~/.aws/config` profiles
- **MFA** — prompts for a token code when a profile requires it; credentials are locally cached until they expire so you are not prompted on every CDK command
- **AWS SSO** — fully supported; detects SSO profiles automatically and uses the cached token from `aws sso login`
- **Multi-account** — each account in `cdk.json` can reference a different profile

## Requirements

- Node.js 18 or later
- AWS CDK v2
- AWS CLI v2 (required for SSO login)

---

## How to Use

### Step 1 — Install the plugin

```bash
npm install -g cdk-cross-account-plugin
```

Make sure your `~/.aws/config` and `~/.aws/credentials` files are configured with the profiles you intend to use.

### Step 2 — Configure `cdk.json`

Add a `plugin` array and a `crossAccountConfig` block that maps each AWS account ID to a named profile:

```json
{
  "app": "python3 app.py",
  "plugin": ["cdk-cross-account-plugin"],
  "crossAccountConfig": {
    "123456789012": {
      "profile": "dev"
    },
    "987654321098": {
      "profile": "prod"
    }
  }
}
```

The plugin intercepts CDK's credential resolution and returns temporary credentials for the appropriate account. You do not need to set `AWS_PROFILE` when using this plugin.

---

## AWS SSO Support

Profiles that use AWS SSO are automatically detected (the plugin looks for `sso_start_url` in the profile). Before running any CDK command, log in with the CLI:

```bash
aws sso login --profile your-profile-name
```

**Example SSO profile in `~/.aws/config`:**

```ini
[profile sso-dev]
sso_start_url = https://yourorg.awsapps.com/start
sso_region = us-west-2
sso_account_id = 123456789012
sso_role_name = YourIAMRole
region = us-west-2
output = json
```

If you deploy to multiple accounts using the same SSO permission set, you can define a separate profile entry for each account ID. Once SSO credentials are obtained, they are locally cached until the session expires.

---

## MFA Support

For profiles that require MFA:

```ini
[profile mfa-prod]
role_arn = arn:aws:iam::987654321098:role/DeployRole
source_profile = default
mfa_serial = arn:aws:iam::111122223333:mfa/your-user
```

The plugin prompts interactively for the MFA token code and caches the resulting temporary credentials locally, so you are only prompted once per session.

---

## Credential Caching

Temporary credentials (both SSO and MFA-based) are cached on disk using [`conf`](https://github.com/sindresorhus/conf). The cache is keyed by profile name and invalidated when the credentials expire. Cache location is printed at plugin load time when debug logging is enabled.

---

## Debugging

Enable verbose logging by setting the `DEBUG` environment variable before running CDK:

```bash
export DEBUG=cdk-cross-account-plugin
cdk deploy
```

---

## Compatibility

| Plugin version | CDK version | AWS SDK |
|---|---|---|
| 3.x | v2 (≥ 2.95.1) | AWS SDK v3 |
| 2.x | v2 | AWS SDK v2 (EOL) |
| 1.x | v1 | AWS SDK v2 (EOL) |

Plugin v3.x uses AWS SDK v3 (`@aws-sdk/client-sso`, `@aws-sdk/credential-providers`) and the `@aws-cdk/cli-plugin-contract` types package. It is not backwards-compatible with CDK v1.

---

## Roadmap

- [x] ~~AWS SSO support~~ **Delivered with v2.0**
- [x] ~~AWS SDK v3 migration~~ **Delivered with v3.0**
