import { AppShell } from "@/components/AppShell";
import { getProfile } from "@/lib/repo";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Your profile</h1>
        <p className="mt-1 text-sm text-slate-500">Used to personalise questions (e.g. asking about projects on your resume). Stored only on this computer.</p>
        <ProfileForm initial={await getProfile()} />
      </div>
    </AppShell>
  );
}
