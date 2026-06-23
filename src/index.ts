import {
    CredentialProviderSource,
    ForReading,
    ForWriting,
    IPluginHost,
    Plugin,
    SDKv3CompatibleCredentials,
} from '@aws-cdk/cli-plugin-contract';
import { SSOClient, GetRoleCredentialsCommand } from '@aws-sdk/client-sso';
import { fromIni } from '@aws-sdk/credential-providers';
import { parseKnownFiles } from '@smithy/shared-ini-file-loader';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve as resolvePath } from 'path';
import { get, has } from 'dot-prop';
import { input } from '@inquirer/prompts';
import { find as findFiles, read as readFile } from 'fs-jetpack';
import { formatDistance } from 'date-fns';
import Conf from 'conf';
import Debug from 'debug';

const log = Debug('cdk-cross-account-plugin');

function getTokenCode(profileName: string, mfaSerial: string): Promise<string> {
    return input({ message: `Enter the MFA code for ${mfaSerial} (profile: ${profileName})` });
}

class CrossAccountCredentialProvider implements CredentialProviderSource {

    name = 'cdk-cross-account-plugin';
    cdkConfig: object = {};
    crossAccountConfig: object = {};
    pluginConfig: Conf;

    constructor() {
        this.pluginConfig = new Conf();
        log(`Using local plugin config storage at ${this.pluginConfig.path}`);
    }

    isAvailable(): Promise<boolean> {
        return Promise.resolve(true);
    }

    canProvideCredentials(accountId: string): Promise<boolean> {
        const pathCdkConfig = `${process.cwd()}/cdk.json`;
        if (existsSync('cdk.json')) {
            this.cdkConfig = JSON.parse(readFileSync(pathCdkConfig, { encoding: 'utf8' }));

            this.crossAccountConfig = get(this.cdkConfig, 'crossAccountConfig') as object ?? {};
            if (Object.keys(this.crossAccountConfig).length === 0) {
                return Promise.resolve(false);
            }
            log(`Found cross account plugin config %o`, this.crossAccountConfig);

            if (has(this.crossAccountConfig, accountId)) {
                log(`Found config for account ${accountId}`);
                return Promise.resolve(true);
            }
        }

        return Promise.resolve(false);
    }

    getProvider(accountId: string, _mode: ForReading | ForWriting): Promise<SDKv3CompatibleCredentials> {
        const config = get(this.crossAccountConfig, accountId) as Record<string, any> | undefined;

        if (!config) {
            return Promise.reject(new Error(`No configuration found for account ${accountId}`));
        }

        if (config.profile) {
            return this.resolveWithProfile(config.profile, accountId);
        }

        return Promise.reject(new Error(`No profile configured for account ${accountId}`));
    }

    async resolveWithProfile(profileName: string, targetAccount: string): Promise<SDKv3CompatibleCredentials> {
        log(`Resolving credentials with named profile ${profileName}`);

        if (this.pluginConfig.has(`credentialCache.${profileName}`)) {
            const cachedCredentials = this.pluginConfig.get(`credentialCache.${profileName}`) as Record<string, any>;
            const now = new Date().getTime();
            const expires = new Date(cachedCredentials.expireTime as string).getTime();
            if (now < expires) {
                const timeRemaining = formatDistance(now, expires);
                log(`Using existing valid cached credentials (expires in ${timeRemaining})`);

                return {
                    accessKeyId: cachedCredentials.accessKeyId as string,
                    secretAccessKey: cachedCredentials.secretAccessKey as string,
                    sessionToken: cachedCredentials.sessionToken as string | undefined,
                    expiration: new Date(cachedCredentials.expireTime as string),
                };
            }
            log(`Cached credentials have expired`);
        }

        const profiles = await parseKnownFiles({ configFilepath: resolvePath(homedir(), '.aws', 'config') });
        const profile = profiles[profileName] as Record<string, any> | undefined;

        if (profile === undefined) {
            throw new Error(`Unable to find AWS named config profile ${profileName}`);
        }

        if (profile.sso_start_url) {
            const ssoCacheDirectory = resolvePath(homedir(), '.aws', 'sso', 'cache');
            log(`Checking SSO cache directory ${ssoCacheDirectory}`);

            if (!existsSync(ssoCacheDirectory)) {
                throw new Error(`SSO cache directory not found - have you logged into AWS SSO first?`);
            }
            log(`SSO cache directory found (possibly logged in)`);

            const ssoToken = findFiles(ssoCacheDirectory, { matching: ['*.json', '!botocore*'], recursive: false })
                .map((path: string) => readFile(path, 'json') as Record<string, any>)
                .find((cachedToken: Record<string, any>) => {
                    cachedToken.expiresAtNative = new Date((cachedToken.expiresAt as string).replace('UTC', '+00:00'));
                    cachedToken.now = new Date();
                    return cachedToken.startUrl === profile.sso_start_url
                        && cachedToken.region === profile.sso_region
                        && cachedToken.now < cachedToken.expiresAtNative;
                });

            if (ssoToken === undefined) {
                throw new Error(`SSO session for ${profile.sso_start_url} is expired - have you logged into AWS SSO first?`);
            }

            const ssoClient = new SSOClient({ region: profile.sso_region as string });
            log(`Getting credentials from STS with SSO session role=${profile.sso_role_name} account=${targetAccount}`);

            const response = await ssoClient.send(new GetRoleCredentialsCommand({
                roleName: profile.sso_role_name as string,
                accountId: targetAccount,
                accessToken: ssoToken.accessToken as string,
            }));

            if (!response.roleCredentials) {
                throw new Error(`SSO returned no role credentials for account ${targetAccount}`);
            }

            return {
                accessKeyId: response.roleCredentials.accessKeyId!,
                secretAccessKey: response.roleCredentials.secretAccessKey!,
                sessionToken: response.roleCredentials.sessionToken,
                expiration: response.roleCredentials.expiration
                    ? new Date(response.roleCredentials.expiration * 1000)
                    : undefined,
            };
        }

        const provider = fromIni({
            profile: profileName,
            mfaCodeProvider: (mfaSerial: string) => getTokenCode(profileName, mfaSerial),
        });

        const creds = await provider();

        this.pluginConfig.set(`credentialCache.${profileName}.accessKeyId`, creds.accessKeyId);
        this.pluginConfig.set(`credentialCache.${profileName}.secretAccessKey`, creds.secretAccessKey);
        this.pluginConfig.set(`credentialCache.${profileName}.sessionToken`, creds.sessionToken);
        this.pluginConfig.set(`credentialCache.${profileName}.expireTime`, creds.expiration?.toISOString() ?? '');
        log(`Saved new credentials to local plugin cache ${this.pluginConfig.path}`);

        return {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
            expiration: creds.expiration,
        };
    }
}

class CrossAccountCDKPlugin implements Plugin {

    public readonly version = '1';

    init(host: IPluginHost) {
        log(`Loading cross account CDK plugin`);

        host.registerCredentialProviderSource(
            new CrossAccountCredentialProvider());
    }

}

export = new CrossAccountCDKPlugin();
