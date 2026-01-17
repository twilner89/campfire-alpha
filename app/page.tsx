import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/favicon.ico" alt="Campfire" width={28} height={28} priority />
          <div className="text-xl font-semibold">Campfire</div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/game">Enter</Link>
          </Button>
          <Button asChild>
            <Link href="/auth">Sign in</Link>
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Choose the story. Together.</CardTitle>
          <CardDescription>
            Campfire is a communal choose-your-own-adventure where everyone votes on what happens next.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="w-full" asChild>
              <Link href="/game">Go to the current episode</Link>
            </Button>
            <Button className="w-full" variant="outline" asChild>
              <Link href="/auth">Sign in to submit & vote</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Next up: we’ll add submit + vote flows and an admin panel to advance phases.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
