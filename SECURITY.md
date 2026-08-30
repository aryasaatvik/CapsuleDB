# Security policy

CapsuleDB coordinates package-owned database state and may be used alongside
authorization and tenant data. Do not include credentials, connection strings,
customer data, or production database contents in issues, logs, fixtures, or
pull requests.

Please report vulnerabilities privately through GitHub's security advisory
interface for `aryasaatvik/CapsuleDB`. Include the affected version, impact,
and a minimal reproduction when safe.

Hosts remain responsible for client credentials, authorization, tenant policy,
backups, and operational access controls. CapsuleDB deliberately does not
take ownership of those concerns.
