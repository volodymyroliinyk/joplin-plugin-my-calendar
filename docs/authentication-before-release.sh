# Check auth before release:

```
gh auth logout --hostname github.com --user <username>;
gh auth login --hostname github.com --git-protocol https --web;
gh auth status --hostname github.com;

npm login;
npm whoami;
```
