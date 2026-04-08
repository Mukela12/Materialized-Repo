import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mail, Users, Send, Clock, CheckCircle, XCircle, Upload, FileText, AlertCircle, Download, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { CreatorInvitation } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";
import Papa from "papaparse";

const inviteCreatorSchema = z.object({
  creatorName: z.string().min(1, "Creator name is required"),
  creatorEmail: z.string().email("Valid email is required"),
  contentCategory: z.string().optional(),
  message: z.string().optional(),
});

type InviteCreatorForm = z.infer<typeof inviteCreatorSchema>;

interface ParsedCSVRow {
  creatorName: string;
  email: string;
  category?: string;
  message?: string;
  error?: string;
  isValid: boolean;
}

export default function BrandCreators() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState("single");
  const [csvData, setCsvData] = useState<ParsedCSVRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const { data: invitations = [], isLoading } = useQuery<CreatorInvitation[]>({
    queryKey: ["/api/brands/creator-invites"],
  });

  const form = useForm<InviteCreatorForm>({
    resolver: zodResolver(inviteCreatorSchema),
    defaultValues: {
      creatorName: "",
      creatorEmail: "",
      contentCategory: "",
      message: "",
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: InviteCreatorForm) => {
      return apiRequest("POST", "/api/brands/invite-creator", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brands/creator-invites"] });
      toast({
        title: "Invitation Sent",
        description: "The creator has been invited to join your network.",
      });
      form.reset();
    },
    onError: () => {
      toast({
        title: "Failed to Send",
        description: "There was an error sending the invitation.",
        variant: "destructive",
      });
    },
  });

  const bulkInviteMutation = useMutation({
    mutationFn: async (data: { invitations: ParsedCSVRow[] }) => {
      return apiRequest("POST", "/api/brands/invite-creators/bulk", {
        invitations: data.invitations.filter(row => row.isValid).map(row => ({
          creatorName: row.creatorName,
          email: row.email,
          category: row.category,
          message: row.message,
        })),
      });
    },
    onSuccess: (response: { created: number; errors?: { index: number; error: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/brands/creator-invites"] });
      toast({
        title: "Bulk Import Complete",
        description: `${response.created} invitations sent successfully.`,
      });
      setCsvData([]);
      setActiveTab("single");
    },
    onError: () => {
      toast({
        title: "Bulk Import Failed",
        description: "There was an error processing the invitations.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: InviteCreatorForm) => {
    inviteMutation.mutate(data);
  };

  const parseCSV = (content: string): ParsedCSVRow[] => {
    const result = Papa.parse<Record<string, string>>(content, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header: string) => header.toLowerCase().trim(),
    });

    if (result.errors.length > 0) {
      toast({
        title: "CSV Parse Error",
        description: result.errors[0].message,
        variant: "destructive",
      });
      return [];
    }

    const data = result.data;
    if (data.length === 0) {
      toast({
        title: "Empty CSV",
        description: "The CSV file has no data rows.",
        variant: "destructive",
      });
      return [];
    }

    if (data.length > 200) {
      toast({
        title: "Too Many Rows",
        description: "Maximum 200 rows allowed per import.",
        variant: "destructive",
      });
      return [];
    }

    const headers = result.meta.fields?.map(f => f.toLowerCase()) || [];
    const nameKey = headers.find(h => h === "name" || h === "creator_name" || h === "creatorname");
    const emailKey = headers.find(h => h === "email" || h === "creator_email" || h === "creatoremail");
    const categoryKey = headers.find(h => h === "category" || h === "content_category");
    const messageKey = headers.find(h => h === "message" || h === "personal_message");

    if (!nameKey || !emailKey) {
      toast({
        title: "Invalid CSV Format",
        description: "CSV must have 'name' and 'email' columns.",
        variant: "destructive",
      });
      return [];
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    return data.map(row => {
      const creatorName = (row[nameKey] || "").trim();
      const email = (row[emailKey] || "").trim();
      const category = categoryKey ? (row[categoryKey] || "").trim() || undefined : undefined;
      const message = messageKey ? (row[messageKey] || "").trim() || undefined : undefined;

      let error: string | undefined;
      let isValid = true;

      if (!creatorName) {
        error = "Name is required";
        isValid = false;
      } else if (!email) {
        error = "Email is required";
        isValid = false;
      } else if (!emailRegex.test(email)) {
        error = "Invalid email format";
        isValid = false;
      }

      return { creatorName, email, category, message, error, isValid };
    });
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV file.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const parsed = parseCSV(content);
      setCsvData(parsed);
      if (parsed.length > 0) {
        setActiveTab("bulk");
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const downloadTemplate = () => {
    const template = "name,email,category,message\nJohn Doe,john@example.com,Fashion,Welcome to our brand\nJane Smith,jane@example.com,Tech,";
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "creator_invite_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const removeCSVRow = (index: number) => {
    setCsvData(prev => prev.filter((_, i) => i !== index));
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
      case "sent":
        return <Badge variant="outline" className="gap-1 border-blue-500 text-blue-600 dark:text-blue-400"><Send className="h-3 w-3" /> Sent</Badge>;
      case "accepted":
        return <Badge className="gap-1 bg-green-500 dark:bg-green-600"><CheckCircle className="h-3 w-3" /> Accepted</Badge>;
      case "declined":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Declined</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const validCount = csvData.filter(r => r.isValid).length;
  const invalidCount = csvData.filter(r => !r.isValid).length;

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Connect Your Creators</h1>
        <p className="text-muted-foreground mt-1">
          Invite content creators to feature your products in their videos
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send Invitations
            </CardTitle>
            <CardDescription>
              Invite creators individually or import from a CSV file
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="single" data-testid="tab-single-invite">Single Invite</TabsTrigger>
                <TabsTrigger value="bulk" data-testid="tab-bulk-import">
                  CSV Import {csvData.length > 0 && <Badge variant="secondary" className="ml-2">{csvData.length}</Badge>}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single">
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="creatorName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Creator Name</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="Enter creator's name" 
                              {...field}
                              data-testid="input-invite-creator-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="creatorEmail"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Creator Email</FormLabel>
                          <FormControl>
                            <Input 
                              type="email"
                              placeholder="creator@example.com" 
                              {...field}
                              data-testid="input-invite-creator-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="contentCategory"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Content Category (Optional)</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="e.g., Fashion, Tech, Beauty, Lifestyle" 
                              {...field}
                              data-testid="input-invite-category"
                            />
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
                              placeholder="Hi! We love your content and think our products would be a great fit for your audience..."
                              className="resize-none min-h-[100px]"
                              {...field}
                              data-testid="input-invite-message"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button 
                      type="submit" 
                      className="rounded-full gap-2 w-full"
                      disabled={inviteMutation.isPending}
                      data-testid="button-send-creator-invite"
                    >
                      <Send className="h-4 w-4" />
                      {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="bulk">
                {csvData.length === 0 ? (
                  <div className="space-y-4">
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                        isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25"
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      data-testid="csv-drop-zone"
                    >
                      <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="font-medium">Drag and drop a CSV file here</p>
                      <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileSelect(file);
                        }}
                        data-testid="input-csv-file"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-4"
                        onClick={() => fileInputRef.current?.click()}
                        data-testid="button-browse-csv"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Browse Files
                      </Button>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Button
                        type="button"
                        variant="link"
                        className="text-sm p-0 h-auto"
                        onClick={downloadTemplate}
                        data-testid="button-download-template"
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download template
                      </Button>
                      <span>|</span>
                      <span>Max 200 rows</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{validCount} valid</Badge>
                        {invalidCount > 0 && (
                          <Badge variant="destructive">{invalidCount} invalid</Badge>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCsvData([])}
                        data-testid="button-clear-csv"
                      >
                        Clear All
                      </Button>
                    </div>
                    
                    <ScrollArea className="h-[300px] border rounded-lg">
                      <div className="p-2 space-y-2">
                        {csvData.map((row, index) => (
                          <div
                            key={index}
                            className={`flex items-center gap-3 p-2 rounded-md ${
                              row.isValid ? "bg-muted/50" : "bg-destructive/10 border border-destructive/30"
                            }`}
                            data-testid={`csv-row-${index}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{row.creatorName || "(no name)"}</p>
                              <p className="text-xs text-muted-foreground truncate">{row.email || "(no email)"}</p>
                              {row.category && (
                                <Badge variant="outline" className="mt-1 text-xs">{row.category}</Badge>
                              )}
                            </div>
                            {row.error ? (
                              <div className="flex items-center gap-1 text-destructive text-xs">
                                <AlertCircle className="h-3 w-3" />
                                {row.error}
                              </div>
                            ) : (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeCSVRow(index)}
                              data-testid={`button-remove-row-${index}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <Button
                      type="button"
                      className="w-full rounded-full gap-2"
                      disabled={validCount === 0 || bulkInviteMutation.isPending}
                      onClick={() => bulkInviteMutation.mutate({ invitations: csvData })}
                      data-testid="button-send-bulk-invites"
                    >
                      <Send className="h-4 w-4" />
                      {bulkInviteMutation.isPending ? "Sending..." : `Send ${validCount} Invitations`}
                    </Button>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              Sent Invitations
            </CardTitle>
            <CardDescription>
              {isLoading ? "Loading..." : `${invitations.length} invitations sent`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 border rounded-lg animate-pulse">
                    <div className="h-10 w-10 bg-muted rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-muted rounded w-1/2" />
                      <div className="h-3 bg-muted rounded w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : invitations.length > 0 ? (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3 pr-2">
                  {invitations.map((invite) => (
                    <div 
                      key={invite.id}
                      className="flex items-center gap-3 p-3 border rounded-lg"
                      data-testid={`invitation-item-${invite.id}`}
                    >
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary/20 text-primary">
                          {invite.creatorName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{invite.creatorName}</p>
                        <p className="text-sm text-muted-foreground truncate">{invite.email}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {invite.category && (
                            <Badge variant="secondary" className="text-xs">{invite.category}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {invite.invitedAt ? formatDistanceToNow(new Date(invite.invitedAt), { addSuffix: true }) : "Just now"}
                          </span>
                        </div>
                      </div>
                      {getStatusBadge(invite.status)}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No invitations sent yet</p>
                <p className="text-sm">Start inviting creators to grow your network</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
