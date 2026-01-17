import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import AdminPanel from "./AdminPanel";

export default function AdminPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <div className="flex items-center gap-4">
          <Link className="text-sm text-muted-foreground hover:text-foreground" href="/game">
            Game
          </Link>
          <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
            Home
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Game controls</CardTitle>
          <CardDescription>Requires an admin profile.</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminPanel />
        </CardContent>
      </Card>
    </div>
  );
}
