// backend/services/cognito.js
// Thin wrapper around AWS Cognito admin operations used by the Admin Settings UI.
// Uses the EC2 instance role / env AWS credentials automatically.

const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
  AdminResetUserPasswordCommand,
  AdminGetUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
  ListUsersCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-west-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;

const client = new CognitoIdentityProviderClient({ region: REGION });

function assertConfigured() {
  if (!USER_POOL_ID) {
    throw new Error('COGNITO_USER_POOL_ID is not configured on the backend');
  }
}

// Map our DB role values → Cognito group names
const ROLE_TO_GROUP = {
  admin: 'Admin',
  manager: 'Manager',
  lo: 'LO',
  processor: 'Processor',
  external: 'External',
  user: 'LO', // fallback
};

function roleToGroup(role) {
  if (!role) return null;
  return ROLE_TO_GROUP[String(role).toLowerCase()] || null;
}

/**
 * Create a Cognito user with a permanent password set by admin.
 * Does NOT send any invite email (SUPPRESS).
 * Returns { sub, username }
 */
async function adminCreateUser({ email, name, password, role }) {
  assertConfigured();

  // Create the user (suppress Cognito invite email — admin is setting pw directly)
  const createRes = await client.send(new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: email,
    MessageAction: 'SUPPRESS',
    UserAttributes: [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      ...(name ? [{ Name: 'name', Value: name }] : []),
    ],
  }));

  const username = createRes.User?.Username || email;
  const subAttr = (createRes.User?.Attributes || []).find(a => a.Name === 'sub');
  const sub = subAttr ? subAttr.Value : null;

  // Set a permanent password so user can log in immediately
  if (password) {
    await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      Password: password,
      Permanent: true,
    }));
  }

  // Add to role group
  const group = roleToGroup(role);
  if (group) {
    try {
      await client.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: group,
      }));
    } catch (e) {
      // Non-fatal; group may not exist
      console.warn('AdminAddUserToGroup failed:', e.message);
    }
  }

  return { sub, username };
}

async function adminUpdateAttributes(username, { name, email }) {
  assertConfigured();
  const attrs = [];
  if (name) attrs.push({ Name: 'name', Value: name });
  if (email) {
    attrs.push({ Name: 'email', Value: email });
    attrs.push({ Name: 'email_verified', Value: 'true' });
  }
  if (attrs.length === 0) return;
  await client.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
    UserAttributes: attrs,
  }));
}

async function adminSetPassword(username, password, permanent = true) {
  assertConfigured();
  await client.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
    Password: password,
    Permanent: permanent,
  }));
}

async function adminResetPassword(username) {
  assertConfigured();
  await client.send(new AdminResetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

async function adminDisableUser(username) {
  assertConfigured();
  await client.send(new AdminDisableUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

async function adminEnableUser(username) {
  assertConfigured();
  await client.send(new AdminEnableUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

async function adminDeleteUser(username) {
  assertConfigured();
  await client.send(new AdminDeleteUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  }));
}

async function adminSyncGroup(username, role) {
  assertConfigured();
  const desiredGroup = roleToGroup(role);
  if (!desiredGroup) return;

  // Remove from all managed role groups, add to the desired one.
  const allGroups = Object.values(ROLE_TO_GROUP).filter((g, i, arr) => arr.indexOf(g) === i);

  const currentRes = await client.send(new AdminListGroupsForUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: username,
  })).catch(() => null);
  const currentGroups = (currentRes?.Groups || []).map(g => g.GroupName);

  // Remove any managed role groups that aren't the desired one
  for (const g of currentGroups) {
    if (allGroups.includes(g) && g !== desiredGroup) {
      await client.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        GroupName: g,
      })).catch(e => console.warn('AdminRemoveUserFromGroup failed:', e.message));
    }
  }
  if (!currentGroups.includes(desiredGroup)) {
    await client.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
      GroupName: desiredGroup,
    })).catch(e => console.warn('AdminAddUserToGroup failed:', e.message));
  }
}

/**
 * Look up a Cognito username by email. Cognito User Pools with email as an
 * alias allow Username === email directly, but user_sub is the most reliable.
 * We store cognito_sub in the DB, so we can use it as Username for Admin* ops
 * when email alias isn't configured. This helper tries email first, then sub.
 */
async function findUsername({ email, sub }) {
  assertConfigured();
  // Try email directly
  if (email) {
    try {
      const res = await client.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      }));
      return res.Username;
    } catch (_e) { /* fall through */ }
  }
  if (sub) {
    try {
      const res = await client.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: sub,
      }));
      return res.Username;
    } catch (_e) { /* fall through */ }

    // Fallback: ListUsers with sub filter
    try {
      const res = await client.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter: `sub = "${sub}"`,
        Limit: 1,
      }));
      if (res.Users && res.Users[0]) return res.Users[0].Username;
    } catch (_e) { /* ignore */ }
  }
  return null;
}

module.exports = {
  adminCreateUser,
  adminUpdateAttributes,
  adminSetPassword,
  adminResetPassword,
  adminDisableUser,
  adminEnableUser,
  adminDeleteUser,
  adminSyncGroup,
  findUsername,
  roleToGroup,
};
