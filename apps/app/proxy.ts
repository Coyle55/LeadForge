import { authMiddleware } from "@repo/auth/proxy";

const publicPaths = ["/sign-in", "/sign-up", "/access-denied"];

export default authMiddleware(async (auth, request) => {
  if (!publicPaths.some((path) => request.nextUrl.pathname.startsWith(path))) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
