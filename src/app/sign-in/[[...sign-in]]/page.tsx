import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { authConfigured } from "@/lib/auth";

export default function SignInPage() {
  if (!authConfigured()) redirect("/"); // nothing to sign into — SignIn needs a ClerkProvider, which isn't mounted
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <SignIn />
    </div>
  );
}
