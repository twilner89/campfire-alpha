import Link from "next/link";

import AuthForm from "./AuthForm";

export default function AuthPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campfire</h1>
        <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
          Home
        </Link>
      </div>
      <AuthForm />
      <p className="text-sm text-muted-foreground">
        By signing in, you can submit ideas and vote on the next turn of the story.
      </p>
    </div>
  );
}
