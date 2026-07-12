# Security: API Token Exposure Incident

## What Happened
The file `.claude/settings.local.json` was committed to the public repository containing:
- **Hardcoded Bearer tokens** for API authentication
- **Absolute local file paths** exposing machine configuration
- **Overly permissive bash command permissions**

**Status**: The file has been sanitized and added to `.gitignore`, but tokens **remain in git history**.

## Actions Taken ✅
1. ✅ Sanitized the exposed settings file
2. ✅ Added `.claude/settings.local.json` to `.gitignore`
3. ✅ Created secure template file with best practices

## Critical Actions Still Required 🚨

### 1. **REGENERATE ALL API TOKENS** (URGENT)
The Bearer tokens used in API calls are still exposed in git history:
- `dev-admin` tokens
- `dev-op-admin` tokens (operator)

Any token that was in the settings file should be considered compromised.

**Steps:**
- Log into your admin panel
- Regenerate all authentication tokens
- Update your local `.env` file with new tokens
- Do NOT commit the new tokens

### 2. **Review Access Logs**
Check your API server logs for unauthorized access attempts to:
- `http://127.0.0.1:8090/admin/v1/rounds`
- `http://127.0.0.1:8091/play/`

Look for requests from IP addresses you don't recognize.

### 3. **Purge from Git History** (Optional but Recommended)
To completely remove the sensitive data from git history:

**Using BFG Repo-Cleaner (easier):**
```bash
# Install BFG
brew install bfg  # macOS
# or download from https://rtyley.github.io/bfg-repo-cleaner/

# Create a file with patterns to remove
echo ".claude/settings.local.json" > .bfgignore

# Run BFG
bfg --delete-files .claude/settings.local.json

# Force push
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push --force-with-lease
```

**Using git filter-branch (built-in, slower):**
```bash
git filter-branch --tree-filter 'rm -f .claude/settings.local.json' HEAD
git push --force-with-lease
```

### 4. **Enable GitHub Secret Scanning** (if using GitHub Enterprise)
- Go to Settings → Code security and analysis
- Enable "Secret scanning"
- Set up alerts for exposed credentials

## Prevention Going Forward ✅
- `.claude/settings.local.json` is now in `.gitignore`
- Use `.env` files for all credentials (also in `.gitignore`)
- Use environment variables in your code instead of hardcoded values
- Review `.gitignore` before committing anything sensitive

## References
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [GitHub: Secret scanning](https://docs.github.com/en/code-security/secret-scanning)
- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/)
