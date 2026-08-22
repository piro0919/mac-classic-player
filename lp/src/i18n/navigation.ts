import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// 素の next/link だと言語の記録が更新されず、切り替えてもすぐ元に戻される
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
