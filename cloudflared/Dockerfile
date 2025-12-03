FROM busybox:1.36 AS shell

FROM cloudflare/cloudflared:latest
COPY --from=shell /bin/busybox /bin/busybox
RUN ln -s /bin/busybox /bin/sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
