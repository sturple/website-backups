---
title: My Site Name
siteUrl: http://www.mysite.com

### SSH
sshHost: example.com
sshUser: user
sshKey: mysite.pem
sshRemote: public_html

backup:
    active: true    
    remote:
        - public_html
        
database:
    -
        name: database1
        user: user1
        pass: password1        
    -
        name: database2
        user: user2
        pass: password2   

---