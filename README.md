<h1>Testing the echo server</h1>
Install nc or socat

<h4>socat</h4>

1. Interactive Network Client
   To connect to a remote web server on port 80 and send/receive data via your terminal

   > > > socat - TCP4:www.example.com:80\

   You can test the pipelined scenario with the following command line.

   > > > echo -e 'asdf\n1234' | socat tcp:127.0.0.1:1234 -

\- is a shorthand alias for STDIO.
TCP4:www.example.com:80 defines the remote IPv4 target address

2. Port Forwarding / Relaying\
   To listen on local port 8080 and forward all traffic to an entirely different server (e.g., ://example.com on port 80)
   socat TCP4-LISTEN:8080,fork,reuseaddr TCP4:remote.example.com:80

   TCP4-LISTEN:8080: Binds to your local system's port 8080 to wait for connections.fork: Instructs socat to spawn a new child process for every incoming connection, allowing multiple clients to connect at once.reuseaddr: Allows immediate binding to the port even if it was recently closed, avoiding "address already in use" errors.

3. Transferring File\
   To pull a file from a remote server, set up a listener on the receiver side first, then push the file from the sender side.\
   Receiver machine:

   > > > bashsocat TCP4-LISTEN:9999,reuseaddr OPEN:received_file.txt,creat

   Sender machine:

   > > > bashsocat -u FILE:source_file.txt TCP4:receiver-ip-address:9999

   -u forces unidirectional mode, transferring data strictly from left-to-right (from the file to the network socket)

<h2>Reference</h2>

[RFC 9110]: https://datatracker.ietf.org/doc/rfc9110/ "RFC 9110: HTTP Semantics"
[RFC 9112]: https://ietf.org "RFC 9112: HTTP/1.1 Message Syntax"
