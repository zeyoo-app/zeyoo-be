# @zeyoo-app/api-client

Typed web and React Native client generated from the Zeyoo backend OpenAPI contract.

## Install from GitHub Packages

Add this to the consuming repository's `.npmrc`:

```ini
@zeyoo-app:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install the package:

```bash
pnpm add @zeyoo-app/api-client
```

Create a client with the deployed API URL and the app's access-token provider:

```ts
import { createZeyooClient } from '@zeyoo-app/api-client';

const api = createZeyooClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL!,
  getAccessToken: () => authStore.getState().accessToken,
});
```

## Release

Update `version` in `package.json`, commit it, and push a matching `sdk-vX.Y.Z` tag. The backend release workflow regenerates, builds, and publishes the package.
