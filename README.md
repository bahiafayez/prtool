# GitHub Merge Tool

This is a tool that enables auto-merging based on three conditions

1. A reviewer approving
2. Completing a checklist
3. Status checks passing

You can also enable and disable automerging by writing a comment in the pull
request:

`/enable automerge` or  `/disable automerge`

Note: If the pull request title begins with WIP, or HOTFIX, automerging is
disabled. 

## Setting up

1. `npm install`: to install all libraries needed
2. `sudo service nginx start`: to start the nginx server
3. `npm run build`: to transpile the es6 code
4. `npm start`: run the node server
5. `sudo service redis-server start`: to run the redis server

The server has to be setup with nginx, and an upstream proxy.
So in your nginx config file, you'd have something like this:
```
# This is where node is running:
upstream rest_node_js {
      server  127.0.0.1:9090;
}

server {
        listen       80 default_server;
        listen       [::]:80 default_server;
        server_name  localhost;
        root         /home/ec2-user/prtool;

        location / {   # then here you're pointing nginx to it
          proxy_pass http://rest_node_js;
          proxy_redirect off;
        }
}
```
You also have to have redis installed, the application uses the default port which is `6379`

Finally, you have to create a file for your environment variables.
Create `prod.env` in your home folder, and in there you'd include your GitHub access token:

```
export TOKEN=22222222222YOURTOKENHERE2222222222222
```

Then in your bash_profile, you'd add the line below, in order to read your prod file:

```
source $HOME/prod.env
```

Don't forget to create a GitHub app that points to your deployed app (this one)

## logging

All the logs are in the log folder:

- `log/production.log`
- `log/production_error.log` : for the error log

That's it!



