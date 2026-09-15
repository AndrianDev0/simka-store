import { IdentifyAnalyticsUser } from "@/app/components/analytics-events";
import { getCurrentAccount } from "@/lib/customer-auth";

export default async function AccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const account = await getCurrentAccount();
  return <>{account ? <IdentifyAnalyticsUser userId={account.id}/> : null}{children}</>;
}
