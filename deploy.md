# POS CRM Deployment Guide - Supabase + Vercel

## Prerequisites
- [Supabase](https://supabase.com) account
- [Vercel](https://vercel.com) account  
- [GitHub](https://github.com) account (for code hosting)

---

## Phase 1: Setup Supabase Database

### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New project"
3. Choose your organization
4. Enter project details:
   - **Name**: `pos-crm-system`
   - **Database Password**: Generate a strong password (save this!)
   - **Region**: Choose closest to your users
5. Click "Create new project" (takes 2-3 minutes)

### Step 2: Get Connection Details
Once ready, go to **Settings** → **Database**:
- **Host**: `db.xxx.supabase.co`
- **Database name**: `postgres`
- **Port**: `5432`
- **User**: `postgres`
- **Password**: (the one you set)

Also get API credentials from **Settings** → **API**:
- **Project URL**: `https://xxx.supabase.co`
- **Service role key**: `eyJhbGc...` (keep secret!)

### Step 3: Run Database Migration
1. In Supabase dashboard, go to **SQL Editor**
2. Create a new query
3. Copy and paste the entire content from `supabase-migration.sql`
4. Click **Run** to execute
5. Verify tables in **Table Editor**

---

## Phase 2: Deploy Backend to Vercel

### Step 1: Push Code to GitHub
```bash
# Initialize git repository (if not already done)
git init
git add .
git commit -m "Initial commit for deployment"

# Create GitHub repository and push
git remote add origin https://github.com/yourusername/pos-crm-system.git
git branch -M main
git push -u origin main
```

### Step 2: Deploy Backend
1. Go to [vercel.com](https://vercel.com) and login
2. Click "New Project"
3. Import your GitHub repository
4. **Configure Project**:
   - **Framework Preset**: Other
   - **Root Directory**: Leave empty (uses root)
   - **Build Command**: Leave empty
   - **Output Directory**: Leave empty

### Step 3: Configure Backend Environment Variables
In Vercel project settings, go to **Environment Variables** and add:

```env
DB_HOST=db.xxx.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your_supabase_password
JWT_SECRET=your_strong_jwt_secret_here
NODE_ENV=production
FRONTEND_URL=https://your-frontend.vercel.app
```

**Important**: 
- Replace `xxx` with your actual Supabase project ID
- Replace `your_supabase_password` with your actual database password
- Generate a strong JWT secret (use: `openssl rand -base64 32`)
- You'll update `FRONTEND_URL` after deploying frontend

### Step 4: Deploy Backend
1. Click "Deploy" 
2. Wait for deployment to complete
3. Note your backend URL: `https://your-backend.vercel.app`
4. Test the health endpoint: `https://your-backend.vercel.app/api/health`

---

## Phase 3: Deploy Frontend to Vercel

### Step 1: Create Separate Frontend Deployment
1. In Vercel, click "New Project" again
2. Import the same GitHub repository
3. **Configure Project**:
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

### Step 2: Configure Frontend Environment Variables
Add these environment variables:

```env
VITE_API_URL=https://your-backend.vercel.app
```

Replace `your-backend.vercel.app` with your actual backend URL from Step 4 above.

### Step 3: Deploy Frontend
1. Click "Deploy"
2. Wait for deployment to complete
3. Note your frontend URL: `https://your-frontend.vercel.app`

### Step 4: Update Backend CORS
1. Go back to your **backend** Vercel project
2. Update the `FRONTEND_URL` environment variable with your actual frontend URL
3. Redeploy the backend (go to Deployments → click "..." → Redeploy)

---

## Phase 4: Final Configuration

### Step 1: Update Domain Settings (Optional)
If you have custom domains:
1. In Vercel project settings, go to **Domains**
2. Add your custom domain
3. Update environment variables accordingly

### Step 2: Test the Application
1. Visit your frontend URL
2. Try logging in with default admin account:
   - **Email**: `admin@poscrm.com`
   - **Password**: `Admin@2024Secure!`
3. Test key features:
   - User management
   - Product inventory
   - Order creation
   - Settings

### Step 3: Security Checklist
- [ ] Changed default admin password
- [ ] JWT secret is strong and unique
- [ ] Database password is secure
- [ ] Environment variables are properly set
- [ ] CORS origins are correctly configured

---

## Troubleshooting

### Common Issues

**1. CORS Errors**
- Check `FRONTEND_URL` environment variable in backend
- Ensure frontend URL is correct
- Redeploy backend after URL changes

**2. Database Connection Issues**
- Verify Supabase connection details
- Check database password
- Ensure SSL is enabled for production

**3. API Endpoints Not Working**
- Check backend deployment logs in Vercel
- Verify `vercel.json` configuration
- Test individual API endpoints

**4. Frontend Build Errors**
- Check Node.js version compatibility
- Verify all dependencies are installed
- Check build logs for specific errors

### Getting Help
- Check Vercel deployment logs
- Check Supabase logs in dashboard
- Use browser developer tools for frontend issues

---

## Post-Deployment Tasks

1. **Change Default Passwords**
   - Login as admin and change the password
   - Update company settings

2. **Backup Strategy**
   - Set up Supabase database backups
   - Export important data regularly

3. **Monitoring**
   - Set up Vercel analytics
   - Monitor Supabase usage
   - Set up error tracking

4. **Updates**
   - Keep dependencies updated
   - Monitor security advisories
   - Regular backups before updates

---

## URLs to Save
- **Frontend**: `https://your-frontend.vercel.app`
- **Backend**: `https://your-backend.vercel.app`
- **Supabase Dashboard**: `https://app.supabase.com/project/your-project-id`
- **GitHub Repository**: `https://github.com/yourusername/pos-crm-system`

## Default Login
- **Email**: `admin@poscrm.com`
- **Password**: `Admin@2024Secure!`

**⚠️ Important**: Change the default admin password immediately after first login!
