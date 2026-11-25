import { notFound } from "next/navigation";
import Showcase from "./Showcase";

export const metadata = { title: "UI showcase (dev)" };

/** Every shared component in every state, on both surfaces. Development only. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
