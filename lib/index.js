"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const client_sso_1 = require("@aws-sdk/client-sso");
const credential_providers_1 = require("@aws-sdk/credential-providers");
const shared_ini_file_loader_1 = require("@smithy/shared-ini-file-loader");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const dot_prop_1 = require("dot-prop");
const prompts_1 = require("@inquirer/prompts");
const fs_jetpack_1 = require("fs-jetpack");
const date_fns_1 = require("date-fns");
const conf_1 = __importDefault(require("conf"));
const debug_1 = __importDefault(require("debug"));
const log = (0, debug_1.default)('cdk-cross-account-plugin');
function getTokenCode(profileName, mfaSerial) {
    return (0, prompts_1.input)({ message: `Enter the MFA code for ${mfaSerial} (profile: ${profileName})` });
}
class CrossAccountCredentialProvider {
    constructor() {
        this.name = 'cdk-cross-account-plugin';
        this.cdkConfig = {};
        this.crossAccountConfig = {};
        this.pluginConfig = new conf_1.default();
        log(`Using local plugin config storage at ${this.pluginConfig.path}`);
    }
    isAvailable() {
        return Promise.resolve(true);
    }
    canProvideCredentials(accountId) {
        var _a;
        const pathCdkConfig = `${process.cwd()}/cdk.json`;
        if ((0, fs_1.existsSync)('cdk.json')) {
            this.cdkConfig = JSON.parse((0, fs_1.readFileSync)(pathCdkConfig, { encoding: 'utf8' }));
            this.crossAccountConfig = (_a = (0, dot_prop_1.get)(this.cdkConfig, 'crossAccountConfig')) !== null && _a !== void 0 ? _a : {};
            if (Object.keys(this.crossAccountConfig).length === 0) {
                return Promise.resolve(false);
            }
            log(`Found cross account plugin config %o`, this.crossAccountConfig);
            if ((0, dot_prop_1.has)(this.crossAccountConfig, accountId)) {
                log(`Found config for account ${accountId}`);
                return Promise.resolve(true);
            }
        }
        return Promise.resolve(false);
    }
    getProvider(accountId, _mode) {
        const config = (0, dot_prop_1.get)(this.crossAccountConfig, accountId);
        if (!config) {
            return Promise.reject(new Error(`No configuration found for account ${accountId}`));
        }
        if (config.profile) {
            return this.resolveWithProfile(config.profile, accountId);
        }
        return Promise.reject(new Error(`No profile configured for account ${accountId}`));
    }
    async resolveWithProfile(profileName, targetAccount) {
        var _a, _b;
        log(`Resolving credentials with named profile ${profileName}`);
        if (this.pluginConfig.has(`credentialCache.${profileName}`)) {
            const cachedCredentials = this.pluginConfig.get(`credentialCache.${profileName}`);
            const now = new Date().getTime();
            const expires = new Date(cachedCredentials.expireTime).getTime();
            if (now < expires) {
                const timeRemaining = (0, date_fns_1.formatDistance)(now, expires);
                log(`Using existing valid cached credentials (expires in ${timeRemaining})`);
                return {
                    accessKeyId: cachedCredentials.accessKeyId,
                    secretAccessKey: cachedCredentials.secretAccessKey,
                    sessionToken: cachedCredentials.sessionToken,
                    expiration: new Date(cachedCredentials.expireTime),
                };
            }
            log(`Cached credentials have expired`);
        }
        const profiles = await (0, shared_ini_file_loader_1.parseKnownFiles)({ configFilepath: (0, path_1.resolve)((0, os_1.homedir)(), '.aws', 'config') });
        const profile = profiles[profileName];
        if (profile === undefined) {
            throw new Error(`Unable to find AWS named config profile ${profileName}`);
        }
        if (profile.sso_start_url) {
            const ssoCacheDirectory = (0, path_1.resolve)((0, os_1.homedir)(), '.aws', 'sso', 'cache');
            log(`Checking SSO cache directory ${ssoCacheDirectory}`);
            if (!(0, fs_1.existsSync)(ssoCacheDirectory)) {
                throw new Error(`SSO cache directory not found - have you logged into AWS SSO first?`);
            }
            log(`SSO cache directory found (possibly logged in)`);
            const ssoToken = (0, fs_jetpack_1.find)(ssoCacheDirectory, { matching: ['*.json', '!botocore*'], recursive: false })
                .map((path) => (0, fs_jetpack_1.read)(path, 'json'))
                .find((cachedToken) => {
                cachedToken.expiresAtNative = new Date(cachedToken.expiresAt.replace('UTC', '+00:00'));
                cachedToken.now = new Date();
                return cachedToken.startUrl === profile.sso_start_url
                    && cachedToken.region === profile.sso_region
                    && cachedToken.now < cachedToken.expiresAtNative;
            });
            if (ssoToken === undefined) {
                throw new Error(`SSO session for ${profile.sso_start_url} is expired - have you logged into AWS SSO first?`);
            }
            const ssoClient = new client_sso_1.SSOClient({ region: profile.sso_region });
            log(`Getting credentials from STS with SSO session role=${profile.sso_role_name} account=${targetAccount}`);
            const response = await ssoClient.send(new client_sso_1.GetRoleCredentialsCommand({
                roleName: profile.sso_role_name,
                accountId: targetAccount,
                accessToken: ssoToken.accessToken,
            }));
            if (!response.roleCredentials) {
                throw new Error(`SSO returned no role credentials for account ${targetAccount}`);
            }
            return {
                accessKeyId: response.roleCredentials.accessKeyId,
                secretAccessKey: response.roleCredentials.secretAccessKey,
                sessionToken: response.roleCredentials.sessionToken,
                expiration: response.roleCredentials.expiration
                    ? new Date(response.roleCredentials.expiration * 1000)
                    : undefined,
            };
        }
        const provider = (0, credential_providers_1.fromIni)({
            profile: profileName,
            mfaCodeProvider: (mfaSerial) => getTokenCode(profileName, mfaSerial),
        });
        const creds = await provider();
        this.pluginConfig.set(`credentialCache.${profileName}.accessKeyId`, creds.accessKeyId);
        this.pluginConfig.set(`credentialCache.${profileName}.secretAccessKey`, creds.secretAccessKey);
        this.pluginConfig.set(`credentialCache.${profileName}.sessionToken`, creds.sessionToken);
        this.pluginConfig.set(`credentialCache.${profileName}.expireTime`, (_b = (_a = creds.expiration) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : '');
        log(`Saved new credentials to local plugin cache ${this.pluginConfig.path}`);
        return {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
            expiration: creds.expiration,
        };
    }
}
class CrossAccountCDKPlugin {
    constructor() {
        this.version = '1';
    }
    init(host) {
        log(`Loading cross account CDK plugin`);
        host.registerCredentialProviderSource(new CrossAccountCredentialProvider());
    }
}
module.exports = new CrossAccountCDKPlugin();
