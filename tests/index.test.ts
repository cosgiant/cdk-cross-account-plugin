import type { IPluginHost, CredentialProviderSource } from '@aws-cdk/cli-plugin-contract';

// ── Mock all external I/O before the module is loaded ──────────────────────

jest.mock('fs', () => ({
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
}));

jest.mock('os', () => ({
    homedir: jest.fn(() => '/home/testuser'),
}));

jest.mock('@aws-sdk/client-sso', () => ({
    SSOClient: jest.fn(),
    GetRoleCredentialsCommand: jest.fn(),
}));

jest.mock('@aws-sdk/credential-providers', () => ({
    fromIni: jest.fn(),
}));

jest.mock('@smithy/shared-ini-file-loader', () => ({
    parseKnownFiles: jest.fn(),
}));

jest.mock('fs-jetpack', () => ({
    find: jest.fn(),
    read: jest.fn(),
}));

jest.mock('../src/store', () => {
    const mockStore = {
        has: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        path: '/tmp/test-plugin-config',
    };
    return { JsonStore: jest.fn(() => mockStore) };
});

jest.mock('readline', () => ({
    createInterface: jest.fn().mockReturnValue({
        question: jest.fn((_prompt: string, cb: (a: string) => void) => cb('123456')),
        close: jest.fn(),
    }),
}));

jest.mock('debug', () => jest.fn(() => jest.fn()));

// ── Import mocks and the module under test ─────────────────────────────────

import { existsSync, readFileSync } from 'fs';
import { SSOClient, GetRoleCredentialsCommand } from '@aws-sdk/client-sso';
import { fromIni } from '@aws-sdk/credential-providers';
import { parseKnownFiles } from '@smithy/shared-ini-file-loader';
import { find as findFiles, read as readFile } from 'fs-jetpack';
import { JsonStore } from '../src/store';

// Load the plugin singleton
const plugin = require('../src/index');

// ── Helpers ────────────────────────────────────────────────────────────────

function getRegisteredSource(): CredentialProviderSource {
    const mockHost: IPluginHost = {
        registerCredentialProviderSource: jest.fn(),
    };
    plugin.init(mockHost);
    return (mockHost.registerCredentialProviderSource as jest.Mock).mock.calls[0][0];
}

function mockStore() {
    return (JsonStore as unknown as jest.Mock).mock.results[0].value as {
        has: jest.Mock;
        get: jest.Mock;
        set: jest.Mock;
        path: string;
    };
}

// ── Plugin registration ────────────────────────────────────────────────────

describe('CrossAccountCDKPlugin', () => {
    it('exposes version "1"', () => {
        expect(plugin.version).toBe('1');
    });

    it('registers a CredentialProviderSource on init', () => {
        const mockHost: IPluginHost = {
            registerCredentialProviderSource: jest.fn(),
        };
        plugin.init(mockHost);
        expect(mockHost.registerCredentialProviderSource).toHaveBeenCalledTimes(1);
        const source = (mockHost.registerCredentialProviderSource as jest.Mock).mock.calls[0][0];
        expect(source.name).toBe('cdk-cross-account-plugin');
    });
});

// ── isAvailable ────────────────────────────────────────────────────────────

describe('CrossAccountCredentialProvider.isAvailable', () => {
    it('always resolves true', async () => {
        const source = getRegisteredSource();
        await expect(source.isAvailable()).resolves.toBe(true);
    });
});

// ── canProvideCredentials ──────────────────────────────────────────────────

describe('CrossAccountCredentialProvider.canProvideCredentials', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns false when cdk.json does not exist', async () => {
        (existsSync as jest.Mock).mockReturnValue(false);
        const source = getRegisteredSource();
        await expect(source.canProvideCredentials('123456789012')).resolves.toBe(false);
    });

    it('returns false when cdk.json has no crossAccountConfig', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ app: 'node app.js' }));
        const source = getRegisteredSource();
        await expect(source.canProvideCredentials('123456789012')).resolves.toBe(false);
    });

    it('returns false when crossAccountConfig is empty', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ crossAccountConfig: {} }));
        const source = getRegisteredSource();
        await expect(source.canProvideCredentials('123456789012')).resolves.toBe(false);
    });

    it('returns false when account ID is not in crossAccountConfig', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({ crossAccountConfig: { '999999999999': { profile: 'other' } } })
        );
        const source = getRegisteredSource();
        await expect(source.canProvideCredentials('123456789012')).resolves.toBe(false);
    });

    it('returns true when account ID is found in crossAccountConfig', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({ crossAccountConfig: { '123456789012': { profile: 'dev' } } })
        );
        const source = getRegisteredSource();
        await expect(source.canProvideCredentials('123456789012')).resolves.toBe(true);
    });
});

// ── getProvider ────────────────────────────────────────────────────────────

describe('CrossAccountCredentialProvider.getProvider', () => {
    beforeEach(() => jest.clearAllMocks());

    it('rejects when no profile is configured for the account', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({ crossAccountConfig: { '123456789012': {} } })
        );
        const source = getRegisteredSource();
        await source.canProvideCredentials('123456789012');
        await expect(source.getProvider('123456789012', 0)).rejects.toThrow(
            'No profile configured for account 123456789012'
        );
    });

    it('rejects with a clean error when account has no config entry', async () => {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({ crossAccountConfig: { '111111111111': { profile: 'dev' } } })
        );
        const source = getRegisteredSource();
        await source.canProvideCredentials('111111111111'); // populates crossAccountConfig
        await expect(source.getProvider('999999999999', 0)).rejects.toThrow(
            'No configuration found for account 999999999999'
        );
    });
});

// ── resolveWithProfile — credential caching ────────────────────────────────

describe('CrossAccountCredentialProvider.resolveWithProfile — cache', () => {
    beforeEach(() => jest.clearAllMocks());

    function setupSource(profileName = 'dev', accountId = '123456789012') {
        (existsSync as jest.Mock).mockReturnValue(true);
        (readFileSync as jest.Mock).mockReturnValue(
            JSON.stringify({ crossAccountConfig: { [accountId]: { profile: profileName } } })
        );
        const source = getRegisteredSource();
        // prime crossAccountConfig
        (source as any).crossAccountConfig = { [accountId]: { profile: profileName } };
        return source;
    }

    it('returns cached credentials when they are still valid', async () => {
        const source = setupSource();
        const store = mockStore();
        const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
        store.has.mockReturnValue(true);
        store.get.mockReturnValue({
            accessKeyId: 'CACHED_KEY',
            secretAccessKey: 'CACHED_SECRET',
            sessionToken: 'CACHED_TOKEN',
            expireTime: futureExpiry,
        });

        const result = await (source as any).resolveWithProfile('dev', '123456789012');

        expect(result.accessKeyId).toBe('CACHED_KEY');
        expect(result.secretAccessKey).toBe('CACHED_SECRET');
        expect(result.sessionToken).toBe('CACHED_TOKEN');
        expect(parseKnownFiles).not.toHaveBeenCalled();
    });

    it('falls through to re-resolve when cached credentials are expired', async () => {
        const source = setupSource();
        const store = mockStore();
        const pastExpiry = new Date(Date.now() - 3600_000).toISOString();
        store.has.mockReturnValue(true);
        store.get.mockReturnValue({
            accessKeyId: 'OLD_KEY',
            secretAccessKey: 'OLD_SECRET',
            expireTime: pastExpiry,
        });
        (parseKnownFiles as jest.Mock).mockResolvedValue({
            dev: { region: 'us-east-1' }, // non-SSO, no sso_start_url
        });
        (existsSync as jest.Mock).mockReturnValue(false); // no SSO cache dir (shouldn't be reached)
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'NEW_KEY',
            secretAccessKey: 'NEW_SECRET',
            sessionToken: 'NEW_TOKEN',
            expiration: new Date('2099-01-01'),
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        const result = await (source as any).resolveWithProfile('dev', '123456789012');

        expect(result.accessKeyId).toBe('NEW_KEY');
        expect(parseKnownFiles).toHaveBeenCalled();
    });

    it('falls through to re-resolve when no cached entry exists', async () => {
        const source = setupSource();
        const store = mockStore();
        store.has.mockReturnValue(false);
        (parseKnownFiles as jest.Mock).mockResolvedValue({
            dev: { region: 'us-east-1' },
        });
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'FRESH_KEY',
            secretAccessKey: 'FRESH_SECRET',
            expiration: new Date('2099-01-01'),
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        const result = await (source as any).resolveWithProfile('dev', '123456789012');

        expect(result.accessKeyId).toBe('FRESH_KEY');
    });
});

// ── resolveWithProfile — profile not found ─────────────────────────────────

describe('CrossAccountCredentialProvider.resolveWithProfile — profile not found', () => {
    beforeEach(() => jest.clearAllMocks());

    it('throws when the profile does not exist in ~/.aws/config', async () => {
        const source = getRegisteredSource();
        (source as any).crossAccountConfig = { '123456789012': { profile: 'nonexistent' } };
        const store = mockStore();
        store.has.mockReturnValue(false);
        (parseKnownFiles as jest.Mock).mockResolvedValue({}); // empty — profile not found

        await expect(
            (source as any).resolveWithProfile('nonexistent', '123456789012')
        ).rejects.toThrow('Unable to find AWS named config profile nonexistent');
    });
});

// ── resolveWithProfile — SSO path ─────────────────────────────────────────

describe('CrossAccountCredentialProvider.resolveWithProfile — SSO', () => {
    const SSO_PROFILE = {
        sso_start_url: 'https://myorg.awsapps.com/start',
        sso_region: 'us-east-1',
        sso_account_id: '123456789012',
        sso_role_name: 'DevRole',
    };

    beforeEach(() => jest.clearAllMocks());

    function setupSsoSource() {
        const source = getRegisteredSource();
        (source as any).crossAccountConfig = { '123456789012': { profile: 'sso-dev' } };
        mockStore().has.mockReturnValue(false);
        (parseKnownFiles as jest.Mock).mockResolvedValue({ 'sso-dev': SSO_PROFILE });
        return source;
    }

    it('throws when SSO cache directory does not exist', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(false);

        await expect(
            (source as any).resolveWithProfile('sso-dev', '123456789012')
        ).rejects.toThrow('SSO cache directory not found');
    });

    it('throws when no valid SSO token is found in cache', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(true);
        (findFiles as jest.Mock).mockReturnValue(['token1.json']);
        (readFile as jest.Mock).mockReturnValue({
            startUrl: 'https://OTHER.awsapps.com/start',
            region: 'us-east-1',
            expiresAt: new Date(Date.now() + 3600_000).toISOString().replace('Z', 'UTC'),
            accessToken: 'stale-token',
        });

        await expect(
            (source as any).resolveWithProfile('sso-dev', '123456789012')
        ).rejects.toThrow('SSO session for https://myorg.awsapps.com/start is expired');
    });

    it('throws when SSO token is expired', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(true);
        (findFiles as jest.Mock).mockReturnValue(['token1.json']);
        (readFile as jest.Mock).mockReturnValue({
            startUrl: SSO_PROFILE.sso_start_url,
            region: SSO_PROFILE.sso_region,
            expiresAt: new Date(Date.now() - 3600_000).toISOString().replace('Z', 'UTC'),
            accessToken: 'expired-token',
        });

        await expect(
            (source as any).resolveWithProfile('sso-dev', '123456789012')
        ).rejects.toThrow('SSO session for https://myorg.awsapps.com/start is expired');
    });

    it('throws when SSO API returns no roleCredentials', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(true);
        (findFiles as jest.Mock).mockReturnValue(['token1.json']);
        (readFile as jest.Mock).mockReturnValue({
            startUrl: SSO_PROFILE.sso_start_url,
            region: SSO_PROFILE.sso_region,
            expiresAt: new Date(Date.now() + 3600_000).toISOString().replace('Z', 'UTC'),
            accessToken: 'valid-token',
        });
        const mockSend = jest.fn().mockResolvedValue({ roleCredentials: null });
        (SSOClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        (GetRoleCredentialsCommand as unknown as jest.Mock).mockImplementation((args) => args);

        await expect(
            (source as any).resolveWithProfile('sso-dev', '123456789012')
        ).rejects.toThrow('SSO returned no role credentials for account 123456789012');
    });

    it('returns credentials from SSO API on success', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(true);
        (findFiles as jest.Mock).mockReturnValue(['token1.json']);
        (readFile as jest.Mock).mockReturnValue({
            startUrl: SSO_PROFILE.sso_start_url,
            region: SSO_PROFILE.sso_region,
            expiresAt: new Date(Date.now() + 3600_000).toISOString().replace('Z', 'UTC'),
            accessToken: 'valid-sso-token',
        });
        const expirationEpoch = Math.floor(Date.now() / 1000) + 3600;
        const mockSend = jest.fn().mockResolvedValue({
            roleCredentials: {
                accessKeyId: 'SSO_KEY',
                secretAccessKey: 'SSO_SECRET',
                sessionToken: 'SSO_TOKEN',
                expiration: expirationEpoch,
            },
        });
        (SSOClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        (GetRoleCredentialsCommand as unknown as jest.Mock).mockImplementation((args) => args);

        const result = await (source as any).resolveWithProfile('sso-dev', '123456789012');

        expect(result.accessKeyId).toBe('SSO_KEY');
        expect(result.secretAccessKey).toBe('SSO_SECRET');
        expect(result.sessionToken).toBe('SSO_TOKEN');
        expect(result.expiration).toEqual(new Date(expirationEpoch * 1000));
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                roleName: 'DevRole',
                accountId: '123456789012',
                accessToken: 'valid-sso-token',
            })
        );
    });

    it('passes the correct SSO region to SSOClient', async () => {
        const source = setupSsoSource();
        (existsSync as jest.Mock).mockReturnValue(true);
        (findFiles as jest.Mock).mockReturnValue(['token1.json']);
        (readFile as jest.Mock).mockReturnValue({
            startUrl: SSO_PROFILE.sso_start_url,
            region: SSO_PROFILE.sso_region,
            expiresAt: new Date(Date.now() + 3600_000).toISOString().replace('Z', 'UTC'),
            accessToken: 'valid-sso-token',
        });
        const mockSend = jest.fn().mockResolvedValue({
            roleCredentials: {
                accessKeyId: 'SSO_KEY',
                secretAccessKey: 'SSO_SECRET',
            },
        });
        (SSOClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));
        (GetRoleCredentialsCommand as unknown as jest.Mock).mockImplementation((args) => args);

        await (source as any).resolveWithProfile('sso-dev', '123456789012');

        expect(SSOClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
});

// ── resolveWithProfile — named profile / MFA ──────────────────────────────

describe('CrossAccountCredentialProvider.resolveWithProfile — named profile / MFA', () => {
    const PLAIN_PROFILE = { region: 'us-east-1' }; // no sso_start_url

    beforeEach(() => jest.clearAllMocks());

    function setupPlainSource() {
        const source = getRegisteredSource();
        (source as any).crossAccountConfig = { '123456789012': { profile: 'prod' } };
        mockStore().has.mockReturnValue(false);
        (parseKnownFiles as jest.Mock).mockResolvedValue({ prod: PLAIN_PROFILE });
        return source;
    }

    it('returns credentials resolved by fromIni', async () => {
        const source = setupPlainSource();
        const expiration = new Date('2099-01-01T00:00:00Z');
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'INI_KEY',
            secretAccessKey: 'INI_SECRET',
            sessionToken: 'INI_TOKEN',
            expiration,
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        const result = await (source as any).resolveWithProfile('prod', '123456789012');

        expect(result.accessKeyId).toBe('INI_KEY');
        expect(result.secretAccessKey).toBe('INI_SECRET');
        expect(result.sessionToken).toBe('INI_TOKEN');
        expect(result.expiration).toEqual(expiration);
    });

    it('caches resolved credentials in pluginConfig', async () => {
        const source = setupPlainSource();
        const store = mockStore();
        const expiration = new Date('2099-06-01T00:00:00Z');
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'INI_KEY',
            secretAccessKey: 'INI_SECRET',
            sessionToken: 'INI_TOKEN',
            expiration,
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        await (source as any).resolveWithProfile('prod', '123456789012');

        expect(store.set).toHaveBeenCalledWith('credentialCache.prod.accessKeyId', 'INI_KEY');
        expect(store.set).toHaveBeenCalledWith('credentialCache.prod.secretAccessKey', 'INI_SECRET');
        expect(store.set).toHaveBeenCalledWith('credentialCache.prod.sessionToken', 'INI_TOKEN');
        expect(store.set).toHaveBeenCalledWith('credentialCache.prod.expireTime', expiration.toISOString());
    });

    it('passes the profile name to fromIni', async () => {
        const source = setupPlainSource();
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'K', secretAccessKey: 'S',
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        await (source as any).resolveWithProfile('prod', '123456789012');

        expect(fromIni).toHaveBeenCalledWith(
            expect.objectContaining({ profile: 'prod' })
        );
    });

    it('passes mfaCodeProvider to fromIni', async () => {
        const source = setupPlainSource();
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'K', secretAccessKey: 'S',
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        await (source as any).resolveWithProfile('prod', '123456789012');

        const call = (fromIni as jest.Mock).mock.calls[0][0];
        expect(typeof call.mfaCodeProvider).toBe('function');
    });

    it('handles missing expiration gracefully (stores empty string in cache)', async () => {
        const source = setupPlainSource();
        const store = mockStore();
        const mockProvider = jest.fn().mockResolvedValue({
            accessKeyId: 'K',
            secretAccessKey: 'S',
            // no expiration
        });
        (fromIni as jest.Mock).mockReturnValue(mockProvider);

        const result = await (source as any).resolveWithProfile('prod', '123456789012');

        expect(result.expiration).toBeUndefined();
        expect(store.set).toHaveBeenCalledWith('credentialCache.prod.expireTime', '');
    });
});
