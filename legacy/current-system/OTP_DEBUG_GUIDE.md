# OTP Verification Troubleshooting Guide

## Changes Made

### 1. Added Debug Logging

- Added comprehensive console logging to both registration and OTP verification endpoints
- Logs will show: received data, database lookups, OTP comparisons, and expiry checks

### 2. Temporary Debug Settings (in .env)

```
OTP_SKIP_EXPIRY=true      # Disables expiry check for testing
OTP_MASTER=<REDACTED>         # Master OTP that always works
```

## How to Debug

### Step 1: Check Backend Logs

1. Look at your backend terminal (running on port 5000)
2. When you try to verify OTP, you should see detailed logs like:
   ```
   === OTP Verification Debug ===
   Received email: user@example.com
   Received OTP: <REDACTED>
   Merchant found: { id: 1, email: '...', storedOtp: '...', ... }
   OTP Comparison: { providedOtp: '...', storedOtp: '...', otpMatches: true/false }
   ```

### Step 2: Common Issues & Solutions

#### Issue 1: "Email not found"

**Cause**: The email in localStorage doesn't match the database
**Solution**:

- Check the email stored in localStorage (browser DevTools > Application > Local Storage)
- Ensure it matches exactly with the registered email

#### Issue 2: "Invalid or expired OTP" - OTP doesn't match

**Cause**: The OTP entered doesn't match what's in the database
**Solutions**:

- Use the master OTP: `<REDACTED>` (now configured)
- Check the registration response - it includes the OTP
- Use the "Resend OTP" button to get a fresh OTP

#### Issue 3: "Invalid or expired OTP" - OTP expired

**Cause**: More than 10 minutes passed since registration/resend
**Solution**:

- OTP_SKIP_EXPIRY is now set to `true`, so this shouldn't happen
- Use "Resend OTP" to get a fresh one

#### Issue 4: OTP is null in database

**Cause**: The OTP wasn't saved during registration or was cleared
**Solution**:

- Re-register with a new email
- Or use "Forgot Password" flow to generate a new OTP

### Step 3: Quick Test

1. **Option A - Use Master OTP**:
   - Enter any registered email
   - Enter OTP: `<REDACTED>`
   - This should work regardless of what's in the database

2. **Option B - Fresh Registration**:
   - Register a new account
   - Note the OTP from the response (shown in the UI or network tab)
   - Use that OTP immediately to verify

### Step 4: Check Database Directly (if needed)

If you have database access, run:

```sql
SELECT id, email, otp, "otpExpires", "isVerified"
FROM merchants
WHERE email = 'your-email@example.com';
```

## What to Look For in Logs

### Successful Verification:

```
=== OTP Verification Debug ===
Received email: test@example.com
Received OTP: <REDACTED>
Merchant found: { id: 1, email: 'test@example.com', storedOtp: '<REDACTED>', ... }
OTP Comparison: { providedOtp: '<REDACTED>', storedOtp: '<REDACTED>', otpMatches: true }
Expiry check skipped (OTP_SKIP_EXPIRY=true)
OTP verification successful - updating merchant
Merchant updated successfully
```

### Failed Verification (OTP mismatch):

```
=== OTP Verification Debug ===
Received email: test@example.com
Received OTP: 654321
Merchant found: { id: 1, email: 'test@example.com', storedOtp: '<REDACTED>', ... }
OTP Comparison: { providedOtp: '654321', storedOtp: '<REDACTED>', otpMatches: false }
OTP does not match - FAILED
```

## Next Steps

1. **Try verifying with master OTP (<REDACTED>)** - This should work immediately
2. **Check the backend terminal** for the debug logs
3. **Share the logs** if the issue persists

## Reverting Debug Settings (After fixing)

Once the issue is resolved, update `.env`:

```
OTP_SKIP_EXPIRY=false
OTP_MASTER=
```

And remove the console.log statements from:

- `backend/controllers/authController.js` (lines with console.log)
