import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Users, 
  UserPlus, 
  Upload, 
  Mail, 
  Clock, 
  CheckCircle2, 
  XCircle,
  Percent
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import Papa from "papaparse";

type AffiliateInvitation = {
  id: string;
  affiliateName: string;
  email: string;
  commissionRate: string;
  message: string | null;
  status: "pending" | "sent" | "accepted" | "declined";
  inviteToken: string;
  createdAt: string;
};

const inviteFormSchema = z.object({
  affiliateName: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  commissionRate: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid commission rate"),
  message: z.string().optional(),
});

type InviteFormValues = z.infer<typeof inviteFormSchema>;

export default function Affiliates() {
  const { toast } = useToast();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [csvData, setCsvData] = useState<any[]>([]);

  const { data: invitations = [], isLoading } = useQuery<AffiliateInvitation[]>({
    queryKey: ['/api/affiliates/invitations'],
  });

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: {
      affiliateName: "",
      email: "",
      commissionRate: "10.00",
      message: "",
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: InviteFormValues) => {
      const res = await apiRequest('/api/affiliates/invite', 'POST', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/affiliates/invitations'] });
      toast({
        title: "Invitation Sent",
        description: "Affiliate invitation has been sent successfully.",
      });
      setIsInviteOpen(false);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send invitation. Please try again.",
        variant: "destructive",
      });
    },
  });

  const bulkInviteMutation = useMutation({
    mutationFn: async (invitations: any[]) => {
      const res = await apiRequest('/api/affiliates/invite/bulk', 'POST', { invitations });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/affiliates/invitations'] });
      toast({
        title: "Bulk Import Complete",
        description: `${data.created} invitations have been created.`,
      });
      setIsBulkOpen(false);
      setCsvData([]);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to import affiliates. Please check your CSV format.",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: (results) => {
        const validData = results.data.filter((row: any) => 
          row.affiliateName && row.email
        ).slice(0, 200);
        setCsvData(validData);
        toast({
          title: "CSV Loaded",
          description: `Found ${validData.length} valid entries (max 200).`,
        });
      },
      error: () => {
        toast({
          title: "Error",
          description: "Failed to parse CSV file.",
          variant: "destructive",
        });
      },
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return <Badge className="bg-chart-2 text-white"><CheckCircle2 className="w-3 h-3 mr-1" />Accepted</Badge>;
      case "declined":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Declined</Badge>;
      case "sent":
        return <Badge variant="secondary"><Mail className="w-3 h-3 mr-1" />Sent</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  const totalAffiliates = invitations.filter(i => i.status === "accepted").length;
  const pendingInvites = invitations.filter(i => i.status === "pending" || i.status === "sent").length;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            Affiliate Management
          </h1>
          <p className="text-muted-foreground">
            Invite and manage affiliates to promote your video content
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-bulk-invite">
                <Upload className="w-4 h-4 mr-2" />
                Bulk Import
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Bulk Import Affiliates</DialogTitle>
                <DialogDescription>
                  Upload a CSV file with affiliate information. Max 200 entries per import.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>CSV File</Label>
                  <Input
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    data-testid="input-csv-upload"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required columns: affiliateName, email. Optional: commissionRate, message
                  </p>
                </div>
                {csvData.length > 0 && (
                  <div className="border rounded-lg p-4 max-h-48 overflow-auto">
                    <p className="text-sm font-medium mb-2">Preview ({csvData.length} entries):</p>
                    <div className="space-y-1">
                      {csvData.slice(0, 5).map((row, i) => (
                        <div key={i} className="text-xs text-muted-foreground">
                          {row.affiliateName} - {row.email}
                        </div>
                      ))}
                      {csvData.length > 5 && (
                        <p className="text-xs text-muted-foreground">...and {csvData.length - 5} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsBulkOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => bulkInviteMutation.mutate(csvData)}
                  disabled={csvData.length === 0 || bulkInviteMutation.isPending}
                  data-testid="button-confirm-bulk-import"
                >
                  {bulkInviteMutation.isPending ? "Importing..." : `Import ${csvData.length} Affiliates`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-invite-affiliate">
                <UserPlus className="w-4 h-4 mr-2" />
                Invite Affiliate
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite Affiliate</DialogTitle>
                <DialogDescription>
                  Send an invitation to a new affiliate partner.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => inviteMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="affiliateName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Affiliate Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John Doe" {...field} data-testid="input-affiliate-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="john@example.com" {...field} data-testid="input-affiliate-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="commissionRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Commission Rate (%)</FormLabel>
                        <FormControl>
                          <Input type="text" placeholder="10.00" {...field} data-testid="input-commission-rate" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Personal Message (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Add a personal note to your invitation..." 
                            {...field} 
                            data-testid="input-invite-message"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={inviteMutation.isPending} data-testid="button-send-invite">
                      {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Total Affiliates</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-affiliates">
              {totalAffiliates}
            </div>
            <p className="text-xs text-muted-foreground">Active partnerships</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Pending Invitations</CardTitle>
            <Mail className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pending-invites">
              {pendingInvites}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting response</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Commission</CardTitle>
            <Percent className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {invitations.length > 0 
                ? (invitations.reduce((sum, i) => sum + parseFloat(i.commissionRate), 0) / invitations.length).toFixed(1)
                : "0"}%
            </div>
            <p className="text-xs text-muted-foreground">Average rate</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : invitations.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <CardTitle className="mb-2">No Affiliates Yet</CardTitle>
          <CardDescription>
            Start building your affiliate network by inviting partners to promote your content.
          </CardDescription>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Invitations</CardTitle>
            <CardDescription>
              Track and manage your affiliate invitations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => (
                  <TableRow key={invitation.id} data-testid={`row-invitation-${invitation.id}`}>
                    <TableCell className="font-medium">{invitation.affiliateName}</TableCell>
                    <TableCell>{invitation.email}</TableCell>
                    <TableCell>{invitation.commissionRate}%</TableCell>
                    <TableCell>{getStatusBadge(invitation.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(invitation.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
