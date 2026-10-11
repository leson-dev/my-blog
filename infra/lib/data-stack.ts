import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";
import { brandingAssets, brandingSettings } from "./branding";
import type { BlogConfig } from "./config";

/** Stateful resources: retained on delete, stack protected against termination. */
export class DataStack extends Stack {
  readonly table: dynamodb.TableV2;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: StackProps & { config: BlogConfig }) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;

    this.table = new dynamodb.TableV2(this, "BlogTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: "byUpdated",
          partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
          sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
        },
      ],
    });

    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, "E2EGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "e2e",
      description: "E2E test account: may only modify drafts (enforced by the API)",
    });

    const appUrls = [`https://${config.adminHost}/`, `${config.adminDevOrigin}/`];
    this.userPoolClient = this.userPool.addClient("AdminClient", {
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: appUrls,
        logoutUrls: appUrls,
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    this.userPoolDomain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `oki-dev-blog-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    // Managed login styled with the C1 colours and the ~/oki-dev$ logo (spec ui-i18n 4).
    new cognito.CfnManagedLoginBranding(this, "LoginBranding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      settings: brandingSettings(),
      assets: brandingAssets(),
    });
  }
}
