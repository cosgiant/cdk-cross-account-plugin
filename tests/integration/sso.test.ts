/**
 * Integration test — SSO credential resolution
 *
 * Prerequisites:
 *   1. Set environment variables:
 *        export CDK_PLUGIN_TEST_PROFILE=<your-sso-profile>
 *        export CDK_PLUGIN_TEST_ACCOUNT=<aws-account-id>
 *   2. Authenticate:
 *        aws sso login --profile $CDK_PLUGIN_TEST_PROFILE
 *   3. Run:
 *        npm run test:integration
 *
 * No mocks — exercises the real AWS SDK v3 SSO flow end-to-end.
 * The suite auto-skips if the required env vars are absent or no
 * fresh SSO token is found in ~/.aws/sso/cache.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PROFILE = process.env.CDK_PLUGIN_TEST_PROFILE ?? '';
const ACCOUNT_ID = process.env.CDK_PLUGIN_TEST_ACCOUNT ?? '';
const SSO_CACHE_DIR = path.resolve(os.homedir(), '.aws', 'sso', 'cache');
const AWS_CONFIG_PATH = path.resolve(os.homedir(), '.aws', 'config');

function getSsoStartUrl(): string | undefined {
    if (!PROFILE || !fs.existsSync(AWS_CONFIG_PATH)) return undefined;
    try {
        const config = fs.readFileSync(AWS_CONFIG_PATH, 'utf8');
        const section = config.match(new RegExp(`\\[(?:profile )?${PROFILE}\\]([^\\[]*)`))?.[1] ?? '';
        return section.match(/sso_start_url\s*=\s*(.+)/)?.[1].trim();
    } catch {
        return undefined;
    }
}

function hasFreshSsoToken(ssoStartUrl: string): boolean {
    if (!fs.existsSync(SSO_CACHE_DIR)) return false;
    return fs.readdirSync(SSO_CACHE_DIR)
        .filter(f => !f.startsWith('botocore') && f.endsWith('.json'))
        .some(f => {
            try {
                const raw = fs.readFileSync(path.join(SSO_CACHE_DIR, f), 'utf8');
                const token = JSON.parse(raw) as Record<string, string>;
                const expires = new Date(token.expiresAt.replace('UTC', '+00:00'));
                return token.startUrl === ssoStartUrl && expires > new Date();
            } catch {
                return false;
            }
        });
}

const ssoStartUrl = getSsoStartUrl();
const envReady = Boolean(PROFILE && ACCOUNT_ID);
const ssoReady = envReady && Boolean(ssoStartUrl) && hasFreshSsoToken(ssoStartUrl!);

if (!envReady) {
    console.warn('\n⚠️  SSO integration tests skipped — set CDK_PLUGIN_TEST_PROFILE and CDK_PLUGIN_TEST_ACCOUNT first.\n');
} else if (!ssoReady) {
    console.warn(`\n⚠️  SSO integration tests skipped — run: aws sso login --profile ${PROFILE}\n`);
}

(ssoReady ? describe : describe.skip)('SSO integration', () => {
    let tmpDir: string;
    let originalCwd: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let src: any;

    beforeAll(() => {
        originalCwd = process.cwd();

        // Plugin reads cdk.json from process.cwd() at call time, so we
        // create a temp dir with a minimal cdk.json and chdir into it.
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-plugin-integration-'));
        fs.writeFileSync(
            path.join(tmpDir, 'cdk.json'),
            JSON.stringify({
                app: 'echo noop',
                crossAccountConfig: {
                    [ACCOUNT_ID]: { profile: PROFILE },
                },
            }),
        );
        process.chdir(tmpDir);

        // Load plugin after chdir so cdk.json lookup resolves correctly.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const plugin = require('../../src/index');
        plugin.init({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            registerCredentialProviderSource: (s: any) => { src = s; },
        });
    });

    afterAll(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('isAvailable() returns true', async () => {
        expect(await src.isAvailable()).toBe(true);
    });

    it('canProvideCredentials returns true for the configured account', async () => {
        expect(await src.canProvideCredentials(ACCOUNT_ID)).toBe(true);
    });

    it('canProvideCredentials returns false for an unconfigured account', async () => {
        expect(await src.canProvideCredentials('000000000000')).toBe(false);
    });

    it('getProvider rejects for an unconfigured account', async () => {
        await expect(src.getProvider('000000000000', 1)).rejects.toThrow(
            'No configuration found for account 000000000000',
        );
    });

    it('getProvider resolves SSO credentials with the correct shape', async () => {
        const creds = await src.getProvider(ACCOUNT_ID, 1 /* ForReading */);

        // Temporary credentials from STS always start with ASIA
        expect(creds.accessKeyId).toMatch(/^ASIA[A-Z0-9]{16}$/);
        expect(typeof creds.secretAccessKey).toBe('string');
        expect(creds.secretAccessKey.length).toBeGreaterThan(0);
        // SSO always issues session tokens
        expect(typeof creds.sessionToken).toBe('string');
        expect((creds.sessionToken as string).length).toBeGreaterThan(0);
        // Expiration must be a future Date
        expect(creds.expiration).toBeInstanceOf(Date);
        expect((creds.expiration as Date).getTime()).toBeGreaterThan(Date.now());
    });

    it('getProvider second call returns from plugin cache (no AWS API call)', async () => {
        // The plugin caches credentials in Conf after the first getProvider call.
        // A second call for the same account should return the same accessKeyId.
        const first = await src.getProvider(ACCOUNT_ID, 1);
        const second = await src.getProvider(ACCOUNT_ID, 1);
        expect(second.accessKeyId).toBe(first.accessKeyId);
    });
});
