"use client";

/**
 * NewTransactionDialog — manual transaction entry for live demonstrations.
 *
 * Submitting POSTs to /api/transactions: the backend validates, checks
 * duplicates, scores the payment against the CUSTOMER'S STORED HISTORY
 * (velocity, baselines, device novelty all use real ledger context) and
 * persists it. The scored row then appears in the dashboard and ledger
 * through the normal polling path.
 *
 * Honest labeling: records created here are dataSource="manual".
 */

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCreateTransaction } from "@/hooks/useLedger";
import { useAppStore } from "@/store/appStore";
import { RiskLevelBadge } from "@/components/risk/RiskBadge";
import { formatINR } from "@/lib/format";
import type { Transaction } from "@/types";

const METHODS = ["UPI", "Credit Card", "Debit Card", "Netbanking", "Wallet"] as const;

export function NewTransactionDialog() {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [merchant, setMerchant] = useState("");
  const [location, setLocation] = useState("");
  const [device, setDevice] = useState("");
  const [method, setMethod] = useState<string>("UPI");
  const [created, setCreated] = useState<Transaction | null>(null);
  const { toast } = useToast();
  const create = useCreateTransaction();
  const injectTransactions = useAppStore((s) => s.injectTransactions);

  const amountNum = Number.parseFloat(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0 && customerId.trim().length >= 2;

  function reset() {
    setAmount("");
    setCustomerId("");
    setCustomerName("");
    setMerchant("");
    setLocation("");
    setDevice("");
    setMethod("UPI");
    setCreated(null);
  }

  async function handleSubmit() {
    if (!valid) return;
    try {
      const txn = await create.mutateAsync({
        amount: amountNum,
        customerId: customerId.trim().toUpperCase(),
        customerName: customerName.trim() || undefined,
        merchant: merchant.trim() || undefined,
        location: location.trim() || undefined,
        device: device.trim() || undefined,
        paymentMethod: method,
        dataSource: "manual",
      });
      setCreated(txn);
      injectTransactions([txn]);
      toast({
        title: `Scored ${txn.id}`,
        description: `${formatINR(txn.amount)} → risk ${txn.riskScore} (${txn.riskLevel}). Stored in the ledger.`,
      });
    } catch (err) {
      toast({
        title: "Could not store the transaction",
        description: err instanceof Error ? err.message : "Unknown error — check the server.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5 bg-intel text-[12px] font-medium text-white hover:bg-intel/85">
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto border-line bg-surface-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b border-line px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold text-slate-100">New transaction</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-relaxed text-slate-500">
            The payment is stored in the SQLite ledger and scored against the
            customer&apos;s stored history — velocity, baselines and device
            novelty all use real context. Fields left blank disable their
            signals and are reported as data-quality warnings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ntx-amount" className="text-[11.5px] text-slate-400">Amount (₹) *</Label>
              <Input
                id="ntx-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="2450"
                className="h-9 border-line bg-surface-1 font-mono text-[12.5px] text-slate-200"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ntx-method" className="text-[11.5px] text-slate-400">Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="ntx-method" className="h-9 border-line bg-surface-1 text-[12.5px] text-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-line bg-surface-1">
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="text-[12.5px]">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ntx-custid" className="text-[11.5px] text-slate-400">Customer ID *</Label>
              <Input
                id="ntx-custid"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="CUS_201"
                className="h-9 border-line bg-surface-1 font-mono text-[12.5px] text-slate-200"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-[10.5px] leading-snug text-slate-600">
                An existing id scores against that customer&apos;s real history.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ntx-custname" className="text-[11.5px] text-slate-400">Customer name</Label>
              <Input
                id="ntx-custname"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ananya Sharma"
                className="h-9 border-line bg-surface-1 text-[12.5px] text-slate-200"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ntx-merchant" className="text-[11.5px] text-slate-400">Merchant</Label>
              <Input
                id="ntx-merchant"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Croma"
                className="h-9 border-line bg-surface-1 text-[12.5px] text-slate-200"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ntx-location" className="text-[11.5px] text-slate-400">Location</Label>
              <Input
                id="ntx-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Mumbai"
                className="h-9 border-line bg-surface-1 text-[12.5px] text-slate-200"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ntx-device" className="text-[11.5px] text-slate-400">Device fingerprint</Label>
            <Input
              id="ntx-device"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="iPhone-14-B2"
              className="h-9 border-line bg-surface-1 font-mono text-[12.5px] text-slate-200"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          {created && (
            <div role="status" className="rounded-sm border border-intel/35 bg-intel/8 px-3 py-2.5 text-[12px] text-intel">
              <div className="flex items-center gap-2">
                <span className="num font-medium">{created.id}</span>
                <RiskLevelBadge level={created.riskLevel} />
              </div>
              <p className="num mt-1 text-[11.5px] text-slate-400">
                {formatINR(created.amount)} · risk score {created.riskScore} · recommendation {created.recommendation ?? "—"} · stored in ledger
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-line pt-3.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 border-line bg-surface-1 text-[12px] text-slate-300 hover:bg-surface-2"
              onClick={() => reset()}
            >
              Clear
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!valid || create.isPending}
              onClick={() => void handleSubmit()}
              className="h-8 gap-1.5 bg-intel text-[12px] font-medium text-white hover:bg-intel/85"
            >
              {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
              Score &amp; store
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
