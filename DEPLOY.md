# Open the Box: Deploy Guide (about 15 minutes, free)

## 1. Supabase (database and logins)
1. Go to supabase.com and click **New project**. Name it `open-the-box`, make up a database password, choose the region closest to you, pick the **Free** plan, then click Create. Wait about 2 minutes.
2. In the left menu, open **SQL Editor**, then **New query**. Paste the entire contents of `supabase/migrations/20250101000000_init.sql` and click **Run**. You should see "Success".
3. Open **Authentication**, then **Sign In / Providers**:
   - Turn **OFF** "Allow new users to sign up". The app creates moderator accounts itself and enforces the 10-seat cap.
   - Under **Email**, turn **OFF** "Confirm email".
4. Open **Project Settings**, then **API** (or **API Keys**). Copy the **Project URL**, the **anon / public** key, and the **service_role** key (keep this one secret).

## 2. GitHub (holds the code)
1. Go to github.com and click **New repository**. Name it `open-the-box`, set it to **Private**, then click Create.
2. Click **uploading an existing file**. Drag in everything from inside the unzipped `open-the-box` folder, then click **Commit changes**.

## 3. Vercel (hosts the site)
1. Go to vercel.com, click **Add New…**, then **Project**, and import the `open-the-box` GitHub repo.
2. Open **Environment Variables** and add these four:
   | Name | Value |
   |---|---|
   | NEXT_PUBLIC_SUPABASE_URL | Supabase Project URL |
   | NEXT_PUBLIC_SUPABASE_ANON_KEY | anon / public key |
   | SUPABASE_SERVICE_ROLE_KEY | service_role key |
   | CRON_SECRET | any long random text |
3. Click **Deploy**. When it finishes you get a URL like `https://open-the-box.vercel.app`.

## 4. Finish the login settings
In Supabase, open **Authentication**, then **URL Configuration**:
- **Site URL**: your Vercel URL
- **Redirect URLs**: add `https://YOUR-URL/**`

## 5. First run
Open your URL and click **Sign up**. The first account becomes the **admin**. Create a box, add your team, and share the drop link. 🎉
